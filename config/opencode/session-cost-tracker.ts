import type { Plugin, PluginInput } from "@opencode-ai/plugin";

interface SessionRecord {
  sessionID: string;
  slug: string;
  title: string;
  model: string;
  provider: string;
  agent: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  directory: string;
  createdAt: number;
}

const SESSIONS_FILE = ".opencode-sessions.json";

export default (async ({ directory, $ }) => {
  let sessions: SessionRecord[] = [];

  try {
    const existing = await $.text`cat ${SESSIONS_FILE}`.catch(() => null);
    if (existing) {
      sessions = JSON.parse(existing);
    }
  } catch {}

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const info = event.properties.info;
        const modelID = info.model?.id || "unknown";
        const providerID = info.model?.providerID || "unknown";
        const newSession: SessionRecord = {
          sessionID: info.id,
          slug: info.slug,
          title: info.title || "Untitled",
          model: modelID,
          provider: providerID,
          agent: info.agent || "unknown",
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          directory: info.directory,
          createdAt: info.time.created,
        };
        sessions.push(newSession);
        await $.text`cat > ${SESSIONS_FILE} <<< ${JSON.stringify(sessions, null, 2)}`;
      }

      if (event.type === "session.updated") {
        const info = event.properties.info;
        const idx = sessions.findIndex((s) => s.sessionID === info.id);
        if (idx !== -1) {
          sessions[idx].cost = info.cost ?? sessions[idx].cost;
          sessions[idx].tokens = {
            input: info.tokens?.input ?? sessions[idx].tokens.input,
            output: info.tokens?.output ?? sessions[idx].tokens.output,
            reasoning: info.tokens?.reasoning ?? sessions[idx].tokens.reasoning,
            cacheRead: info.tokens?.cache?.read ?? sessions[idx].tokens.cacheRead,
            cacheWrite: info.tokens?.cache?.write ?? sessions[idx].tokens.cacheWrite,
          };
          if (info.title && info.title !== "Untitled") {
            sessions[idx].title = info.title;
          }
          await $.text`cat > ${SESSIONS_FILE} <<< ${JSON.stringify(sessions, null, 2)}`;
        }
      }
    },
  };
}) satisfies Plugin;
