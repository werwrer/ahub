const LIMITS = { task: 0, summary: 3, session: 12, full: Number.POSITIVE_INFINITY };

function clip(text, size = 4000) {
  if (text.length <= size) return text;
  return `${text.slice(0, size)}\n...[truncated]`;
}

export function compileContext(session, task, mode = "summary") {
  if (!(mode in LIMITS)) throw new Error(`invalid context mode: ${mode}`);
  const successfulRuns = session.runs.filter((run) => run.status === "completed");
  const runs = LIMITS[mode] === 0 ? [] : successfulRuns.slice(-LIMITS[mode]);
  const tasks = session.tasks.filter((item) => item.status !== "done");
  const blocks = [
    "You are working through ahub, a local cross-agent coordinator.",
    `Session: ${session.name} (${session.id})`,
    `Workspace: ${session.workspace}`,
  ];
  if (tasks.length) {
    blocks.push(`Open tasks:\n${tasks.map((item) => `- [${item.status}] ${item.title} (${item.id})`).join("\n")}`);
  }
  if (runs.length) {
    blocks.push(`Previous agent results:\n${runs.map((run) => `--- ${run.runtime} / ${run.id} ---\n${clip(run.output)}`).join("\n")}`);
  }
  blocks.push(`Current task:\n${task}`);
  return {
    prompt: blocks.join("\n\n"),
    manifest: {
      mode,
      previousRunIds: runs.map((run) => run.id),
      openTaskIds: tasks.map((item) => item.id),
      estimatedCharacters: blocks.join("\n\n").length,
    },
  };
}
