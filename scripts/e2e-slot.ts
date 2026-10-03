import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `e2e-slot <command…>`: run a command while holding the machine's single e2e slot, a `mkdir` lock at
 * $E2E_SLOT_DIR (default ~/.cache/e2e-slot). Exits 75 when the slot stays busy past E2E_SLOT_WAIT_MS (default 20 min).
 */
export const E2E_SLOT_SCRIPT = join(import.meta.dir, "e2e-slot.ts");
export const BUSY_EXIT = 75;
const STALE_MS = 30_000;
const LOG_EVERY_MS = 60_000;

export interface Owner { pid: number; cwd: string; command: string; since: number }
export interface SlotDeps {
  lockDir: string;
  /** Alive and still an e2e-slot process (not a reused pid). */
  isHolder: (pid: number) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  waitCapMs: number;
  pollMs: number;
}

export function readOwner(lockDir: string): Owner | null {
  try {
    const o = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
    return typeof o?.pid === "number" ? o : null;
  } catch {
    return null;
  }
}

const ageMs = (dir: string, now: number) => {
  try { return now - statSync(dir).mtimeMs; } catch { return null; }
};

function tryAcquire(me: Omit<Owner, "since">, d: SlotDeps): boolean {
  mkdirSync(dirname(d.lockDir), { recursive: true });
  try {
    mkdirSync(d.lockDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  writeFileSync(join(d.lockDir, "owner.json"), JSON.stringify({ ...me, since: d.now() }));
  return true;
}

function isDead(d: SlotDeps): boolean {
  const owner = readOwner(d.lockDir);
  if (owner) return !d.isHolder(owner.pid);
  const age = ageMs(d.lockDir, d.now());
  return age !== null && age > STALE_MS; // no owner.json yet: a crash between mkdir and the write, once old
}

/** Remove a dead lock under the takeover mutex, re-checking inside it so a fresh lock is never removed. */
function takeOver(d: SlotDeps): void {
  const mutex = `${d.lockDir}.takeover`;
  try {
    mkdirSync(mutex);
  } catch {
    const age = ageMs(mutex, d.now());
    if (age !== null && age > STALE_MS) rmSync(mutex, { recursive: true, force: true });
    return;
  }
  try {
    if (isDead(d)) rmSync(d.lockDir, { recursive: true, force: true });
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/** true once we hold the slot; false after waiting `waitCapMs` for it. */
export async function acquire(me: Omit<Owner, "since">, d: SlotDeps): Promise<boolean> {
  const start = d.now();
  let lastLog = -Infinity;
  for (;;) {
    if (tryAcquire(me, d)) return true;
    if (isDead(d)) {
      takeOver(d);
      if (tryAcquire(me, d)) return true;
    }
    const o = readOwner(d.lockDir);
    if (d.now() - start >= d.waitCapMs) {
      const held = o ? `${o.cwd} since ${hhmm(o.since)}` : "another run";
      d.log(`e2e-slot: gave up after ${Math.round(d.waitCapMs / 60_000)} min — slot held by ${held}; retry later`);
      return false;
    }
    if (d.now() - lastLog >= LOG_EVERY_MS) {
      d.log(`e2e-slot: waiting — held by ${o ? `${o.cwd} (${o.command}) since ${hhmm(o.since)}` : "another run"}`);
      lastLog = d.now();
    }
    await d.sleep(d.pollMs);
  }
}

export function release(lockDir: string, pid: number): void {
  if (readOwner(lockDir)?.pid === pid) rmSync(lockDir, { recursive: true, force: true });
}

/** Alive and still an e2e-slot process: `ps` guards against a reused pid. */
export function isHolder(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]).stdout.toString().includes("e2e-slot");
}

export const lockDirFor = (env = process.env): string => env.E2E_SLOT_DIR ?? join(homedir(), ".cache", "e2e-slot");

/** What the dashboard reads about the slot: no lock dir → exists false. */
export interface SlotProbe { exists: boolean; owner: Owner | null; alive: boolean; mtime: number | null }

export function probeSlot(lockDir: string, holder: (pid: number) => boolean = isHolder): SlotProbe {
  let mtime: number;
  try {
    mtime = statSync(lockDir).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, owner: null, alive: false, mtime: null };
    throw e;
  }
  const owner = readOwner(lockDir);
  return { exists: true, owner, alive: owner ? holder(owner.pid) : false, mtime };
}

export function defaultDeps(env = process.env): SlotDeps {
  const cap = Number(env.E2E_SLOT_WAIT_MS);
  return {
    lockDir: lockDirFor(env),
    isHolder,
    now: Date.now,
    sleep: (ms) => Bun.sleep(ms),
    log: (l) => process.stderr.write(`${l}\n`),
    waitCapMs: Number.isFinite(cap) && cap > 0 ? cap : 20 * 60_000,
    pollMs: 2000,
  };
}

const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;

export async function main(args: string[], d: SlotDeps = defaultDeps()): Promise<number> {
  if (args.length === 0) {
    process.stderr.write("usage: e2e-slot <command> [args…]\n");
    return 2;
  }
  if (!(await acquire({ pid: process.pid, cwd: process.cwd(), command: args.join(" ") }, d))) return BUSY_EXIT;
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  } catch (e) {
    release(d.lockDir, process.pid);
    process.stderr.write(`e2e-slot: ${(e as Error).message}\n`);
    return 127;
  }
  let signal: number | null = null;
  for (const [name, n] of Object.entries(SIGNALS)) {
    process.on(name as NodeJS.Signals, () => { signal = n; child.kill(name as NodeJS.Signals); });
  }
  const code = await child.exited;
  release(d.lockDir, process.pid);
  return signal !== null ? 128 + signal : code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
