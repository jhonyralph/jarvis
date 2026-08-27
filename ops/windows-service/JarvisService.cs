// Host de serviço do Windows para o Jarvis.
//
// POR QUE ISTO EXISTE
// O Hub e o Runner subiam pelo Agendador de Tarefas, com um `while($true)` em PowerShell fazendo o
// papel de supervisor. Três consequências ruins:
//   1. o Agendador roda na sessão do usuário e ALOCA CONSOLE — e como o Windows Terminal é o
//      terminal padrão, ele hospeda esse console numa janela visível. `-WindowStyle Hidden` não
//      resolve: ele esconde a janela do PowerShell, não a que o Terminal cria;
//   2. `Stop-ScheduledTask` não para nada — o supervisor sobrevive e relança o processo;
//   3. reinício-em-falha foi feito à mão, quando o próprio SCM já oferece isso.
// Linux (systemd --user) e macOS (launchd) do repo já usavam o gerenciador de serviços do sistema.
// Isto alinha o Windows com eles. Serviço roda na sessão 0: janela não existe por construção.
//
// POR QUE C# COMPILADO NA INSTALAÇÃO, e não WinSW/NSSM
// Os instaladores do Jarvis não baixam nada — são offline por decisão. Vendorizar um .exe de
// terceiro mudaria isso e ainda pediria confiança num binário. O compilador do .NET Framework já
// vem no Windows, então o host é gerado na hora, a partir deste fonte auditável.
//
// O QUE ELE FAZ
// Só o mínimo: sobe UM processo filho sem console, encaminha a saída para o log, e no stop derruba a
// ÁRVORE inteira (no Windows matar o pai não mata os filhos — foi assim que piper/whisper viraram
// órfãos). Ele não supervisiona: se o filho morre, o host termina com código diferente de zero e
// quem religa é o SCM, com a política de recuperação configurada no install.
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

public class JarvisService : ServiceBase {
  private Process child;
  private readonly string exe, args, workDir, logPath;
  private volatile bool stopping;

  public JarvisService(string name, string exe, string args, string workDir, string logPath) {
    this.ServiceName = name; this.exe = exe; this.args = args;
    this.workDir = workDir; this.logPath = logPath;
    this.CanShutdown = true;
  }

  private void Log(string line) {
    try {
      File.AppendAllText(logPath, string.Format("[service] {0:o} {1}{2}", DateTime.Now, line, Environment.NewLine));
    } catch { /* log é conveniência: nunca pode derrubar o serviço */ }
  }

  protected override void OnStart(string[] ignored) {
    var psi = new ProcessStartInfo(exe, args) {
      UseShellExecute = false,      // obrigatório para redirecionar e para não abrir janela
      CreateNoWindow = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      WorkingDirectory = workDir,
    };
    child = new Process { StartInfo = psi, EnableRaisingEvents = true };
    // O log é o MESMO arquivo que o supervisor antigo usava, e agora em UTF-8: o `*>>` do PowerShell
    // gravava UTF-16LE, e o hub.log virava uma mistura ilegível de codificações.
    child.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
    child.ErrorDataReceived  += (s, e) => { if (e.Data != null) Log(e.Data); };
    child.Exited += (s, e) => {
      if (stopping) return;
      Log(string.Format("processo saiu com codigo {0} — devolvendo ao SCM para religar", child.ExitCode));
      Environment.Exit(child.ExitCode == 0 ? 1 : child.ExitCode);  // saída != 0 aciona a recuperação
    };
    child.Start();
    child.BeginOutputReadLine();
    child.BeginErrorReadLine();
    Log(string.Format("iniciado: {0} {1} (pid {2})", exe, args, child.Id));
  }

  protected override void OnStop() {
    stopping = true;
    if (child == null || child.HasExited) return;
    // /T derruba a ÁRVORE. Sem isso os filhos python (whisper, piper) ficam órfãos a cada parada.
    try {
      Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + child.Id + " /T /F") {
        UseShellExecute = false, CreateNoWindow = true
      }).WaitForExit(10000);
    } catch (Exception ex) { Log("taskkill falhou: " + ex.Message); }
    try { if (!child.WaitForExit(5000)) child.Kill(); } catch { }
    Log("parado");
  }

  protected override void OnShutdown() { OnStop(); }

  public static void Main(string[] argv) {
    // argv: <nome-do-servico> <exe> <workdir> <log> <args...>
    if (argv.Length < 4) { Console.Error.WriteLine("uso: JarvisService <nome> <exe> <workdir> <log> [args...]"); Environment.Exit(2); }
    var rest = string.Join(" ", argv, 4, argv.Length - 4);
    ServiceBase.Run(new JarvisService(argv[0], argv[1], rest, argv[2], argv[3]));
  }
}
