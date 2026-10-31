using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class Stopper
{
    private static string logFile = "";

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    private static void Show(string message)
    {
        if (Environment.GetEnvironmentVariable("ZYB_SILENT") == "1") return;
        MessageBoxW(IntPtr.Zero, message, "中医工作台", 0x00000040u);
    }

    private static void Log(string line)
    {
        try
        {
            if (logFile.Length == 0) return;
            Directory.CreateDirectory(Path.GetDirectoryName(logFile));
            File.AppendAllText(logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine);
        }
        catch
        {
            // logging failure must not block stopping
        }
    }

    [STAThread]
    private static int Main()
    {
        try
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            logFile = Path.Combine(baseDir, "data", "logs", "stopper.log");
            Log("start, base=" + baseDir);

            var pidFile = Path.Combine(baseDir, "data", "server.pid");
            if (!File.Exists(pidFile))
            {
                Log("no pid file");
                Show("工作台没有在运行。");
                return 0;
            }

            var raw = File.ReadAllText(pidFile).Trim();
            Log("pid file content='" + raw + "'");

            int pid;
            if (!int.TryParse(raw, out pid) || pid <= 0)
            {
                TryDelete(pidFile);
                Log("invalid pid, pid file deleted");
                Show("工作台没有在运行。");
                return 0;
            }

            var info = new ProcessStartInfo
            {
                FileName = "taskkill",
                Arguments = "/PID " + pid + " /T /F",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            using (var killer = Process.Start(info))
            {
                if (killer == null)
                {
                    Log("taskkill did not start");
                    Show("停止失败：无法调用 taskkill。");
                    return 1;
                }
                var output = killer.StandardOutput.ReadToEnd();
                var error = killer.StandardError.ReadToEnd();
                killer.WaitForExit(15000);
                Log("taskkill exit=" + killer.ExitCode + " out=" + Flatten(output) + " err=" + Flatten(error));
            }

            TryDelete(pidFile);
            Log("done");
            Show("已停止工作台。");
            return 0;
        }
        catch (Exception ex)
        {
            Log("exception: " + ex);
            Show("停止失败：" + ex.Message + "\n\n可以按 Ctrl+Shift+Esc 打开任务管理器，结束 node.exe。");
            return 1;
        }
    }

    private static string Flatten(string text)
    {
        if (text == null) return "";
        return text.Replace("\r", "").Replace("\n", " | ").Trim();
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // ignore: file may already be gone
        }
    }
}
