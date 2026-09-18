import type { Plugin } from "@opencode-ai/plugin";
import {
  drain,
  migrateIfNeeded,
  scheduleUpdate,
  type SessionInfo,
} from "../lib/session-cost-tracker-core.ts";

export default (async () => {
  await migrateIfNeeded();
  return {
    event: async ({ event }) => {
      if (event.type !== "session.created" && event.type !== "session.updated") {
        return;
      }
      const info = event.properties.info as unknown as SessionInfo;
      try {
        await scheduleUpdate(event.type, info);
      } catch {
        // best-effort cost tracking; never crash opencode
      }
    },
    dispose: drain,
  };
}) satisfies Plugin;
