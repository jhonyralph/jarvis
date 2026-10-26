// Encerra um Hub/runner de verdade lançado por um teste e2e — sem nunca poder pendurar a suíte.
//
// Por que existe (flake da 1ª rodada do pre-push, 2026-10-23): nove testes tinham cada um a sua
// cópia de `stopChild`, todas com `spawnSync("taskkill", …, { stdio: "ignore" })` e o resultado
// jogado fora. Quando a memória virtual da máquina se esgota (evento 2004 do Windows — aconteceu a
// cada travamento daquele dia), CRIAR o processo do taskkill falha; o erro era engolido, o Hub de
// teste sobrevivia, e os pipes stdout/stderr dele prendiam o arquivo de teste para sempre: a suíte
// (e o `git push`, pelo hook) ficava parada sem mensagem nenhuma.
//
// Aqui, em camadas:
//  1. a árvore inteira (taskkill /T no Windows, que leva os netos — ex.: os daemons de voz);
//  2. se não saiu, `kill("SIGKILL")`, que no Windows é TerminateProcess direto — não cria processo,
//     então funciona justamente quando a máquina está sem memória para lançar o taskkill;
//  3. se AINDA assim não saiu, solta os pipes e o handle (o arquivo de teste consegue terminar) e
//     avisa em stderr com o motivo. Não lança: dentro de um `finally`, lançar trocaria o erro real do
//     teste por este.
import { spawnSync, type ChildProcess } from "node:child_process";

export async function stopChild(p: ChildProcess | undefined, graceMs = 3_000): Promise<void> {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  const exited = new Promise<boolean>((resolve) => p.once("exit", () => resolve(true)));
  // `unref`: o timer da espera não pode, ele mesmo, segurar o processo do teste vivo.
  const within = (ms: number) => Promise.race([exited, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref())]);

  let why = "";
  if (process.platform === "win32" && p.pid) {
    const r = spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    if (r.error) why = `taskkill não rodou (${r.error.message})`;
  } else p.kill();
  if (await within(graceMs)) return;

  try { p.kill("SIGKILL"); } catch { /* saiu entre uma checagem e outra */ }
  if (await within(5_000)) return;

  p.stdout?.destroy(); p.stderr?.destroy(); p.stdin?.destroy(); p.unref();
  console.error(`[e2e] ATENÇÃO: processo de teste pid ${p.pid} sobreviveu ao encerramento${why ? ` — ${why}` : ""}; pipes soltos para a suíte não travar.`);
}
