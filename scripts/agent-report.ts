#!/usr/bin/env node
/** Read-only adapter/model conformance report. It never sends a prompt or spends a model turn. */
import {
  AgentRegistry, ClaudeCodeAdapter, CodexAdapter, GeminiCliAdapter, CursorAgentAdapter,
  CopilotCliAdapter, OpenCodeAdapter, ClineCliAdapter, QwenCodeAdapter, ContinueCliAdapter,
  KiroCliAdapter, AntigravityCliAdapter, AiderAdapter, MockAgentAdapter, descriptorProblems,
} from "@jarvis/core";

const registry = new AgentRegistry(process.env.JARVIS_AGENT || "claude-code")
  .register(new ClaudeCodeAdapter()).register(new CodexAdapter()).register(new GeminiCliAdapter())
  .register(new CursorAgentAdapter()).register(new CopilotCliAdapter()).register(new OpenCodeAdapter())
  .register(new ClineCliAdapter()).register(new QwenCodeAdapter()).register(new ContinueCliAdapter())
  .register(new KiroCliAdapter()).register(new AntigravityCliAdapter()).register(new AiderAdapter())
  .register(new MockAgentAdapter());

async function main(): Promise<void> {
const rows = await Promise.all(registry.names().map(async (id) => {
  const adapter = registry.get(id);
  const descriptor = await adapter.descriptor?.();
  if (!descriptor) return { id, support: "limited", problems: ["missing canonical descriptor"] };
  return {
    id, label: descriptor.label, support: descriptor.support, reason: descriptor.reason,
    cli: descriptor.cli, permissionMode: descriptor.capabilities.permissionMode,
    stream: descriptor.capabilities.stream, tools: descriptor.capabilities.tools,
    nativeResume: descriptor.capabilities.nativeResume, usage: descriptor.capabilities.usage,
    models: descriptor.models.map((m) => ({ id: m.id, efforts: m.efforts, effortsVerified: m.effortsVerified, contextTokens: m.contextTokens, contextVerified: m.contextVerified, source: m.source })),
    problems: descriptorProblems(descriptor),
  };
}));

if (process.argv.includes("--json")) console.log(JSON.stringify({ generatedAt: new Date().toISOString(), agents: rows }, null, 2));
else {
  console.log("Jarvis — relatório de conformidade (sem turnos de IA)\n");
  for (const r of rows) {
    const cli = "cli" in r && r.cli ? `${r.cli.command}${r.cli.version ? ` ${r.cli.version}` : " (ausente)"}` : "sem CLI";
    console.log(`${r.id}: ${r.support} · ${cli} · stream=${"stream" in r ? r.stream : "none"} · modelos=${"models" in r ? r.models.length : 0}`);
    if ("reason" in r && r.reason) console.log(`  motivo: ${r.reason}`);
    if (r.problems.length) console.log(`  contrato: ${r.problems.join("; ")}`);
  }
}
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; });
