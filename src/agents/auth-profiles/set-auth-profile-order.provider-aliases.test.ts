import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../../test-utils/env.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  saveAuthProfileStore,
  setAuthProfileOrder,
  type AuthProfileStore,
} from "../auth-profiles.js";

function readStore(agentDir: string): Promise<AuthProfileStore> {
  return fs
    .readFile(path.join(agentDir, "auth-profiles.json"), "utf8")
    .then((value) => JSON.parse(value) as AuthProfileStore);
}

describe("setAuthProfileOrder provider alias handling", () => {
  const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR", "OPENCLAW_AGENT_DIR", "PI_CODING_AGENT_DIR"]);

  let tmpDir: string;
  let mainAgentDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-order-provider-alias-"));
    mainAgentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(mainAgentDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    process.env.OPENCLAW_AGENT_DIR = mainAgentDir;
    process.env.PI_CODING_AGENT_DIR = mainAgentDir;
  });

  afterEach(async () => {
    clearRuntimeAuthProfileStoreSnapshots();
    envSnapshot.restore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("replaces legacy provider alias keys when writing a new order", async () => {
    const a1 = "qwen-portal:account1";
    const a2 = "qwen-portal:account2";
    const baseStore: AuthProfileStore = {
      version: 1,
      profiles: {
        [a1]: {
          type: "oauth",
          provider: "qwen-portal",
          access: "a1",
          refresh: "r1",
          expires: Date.now() + 60_000,
        },
        [a2]: {
          type: "oauth",
          provider: "qwen-portal",
          access: "a2",
          refresh: "r2",
          expires: Date.now() + 60_000,
        },
      },
      order: {
        qwen: [a1, a2],
      },
    };
    saveAuthProfileStore(baseStore, mainAgentDir);

    const updated = await setAuthProfileOrder({
      agentDir: mainAgentDir,
      provider: "qwen-portal",
      order: [a2, a1],
    });
    expect(updated?.order?.qwen).toBeUndefined();
    expect(updated?.order?.["qwen-portal"]).toEqual([a2, a1]);

    const onDisk = await readStore(mainAgentDir);
    expect(onDisk.order?.qwen).toBeUndefined();
    expect(onDisk.order?.["qwen-portal"]).toEqual([a2, a1]);
  });

  it("clears all normalized alias keys when order is reset", async () => {
    const a1 = "qwen-portal:account1";
    const a2 = "qwen-portal:account2";
    const baseStore: AuthProfileStore = {
      version: 1,
      profiles: {
        [a1]: {
          type: "oauth",
          provider: "qwen-portal",
          access: "a1",
          refresh: "r1",
          expires: Date.now() + 60_000,
        },
        [a2]: {
          type: "oauth",
          provider: "qwen-portal",
          access: "a2",
          refresh: "r2",
          expires: Date.now() + 60_000,
        },
      },
      order: {
        qwen: [a1, a2],
        "qwen-portal": [a2, a1],
      },
    };
    saveAuthProfileStore(baseStore, mainAgentDir);

    const updated = await setAuthProfileOrder({
      agentDir: mainAgentDir,
      provider: "qwen-portal",
      order: null,
    });
    expect(updated?.order).toBeUndefined();

    const onDisk = await readStore(mainAgentDir);
    expect(onDisk.order).toBeUndefined();
  });
});
