using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

internal static class Autostart
{
    private static string baseDir = "";
    private const string FileName = "中医工作台-后台启动.vbs";

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
            var dir = Path.Combine(baseDir, "data", "logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "autostart.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine);
        }
        catch
        {
            // logging is best-effort
        }
    }

    // 依次尝试多种写入方式：直接写 → 复制临时文件 → cmd copy → HKCU Run
    private static bool TryInstall(string script, string vbs, string exe, out string trace)
    {
        var log = new StringBuilder();

        try
        {
            var bytes = Encoding.Unicode.GetBytes(vbs);
            var withBom = new byte[bytes.Length + 2];
            withBom[0] = 0xFF;
            withBom[1] = 0xFE;
            Array.Copy(bytes, 0, withBom, 2, bytes.Length);
            File.WriteAllBytes(script, withBom);
            if (File.Exists(script))
            {
                trace = "direct ok";
                return true;
            }
        }
        catch (Exception ex)
        {
            log.Append("direct:" + ex.GetType().Name + " ");
        }

        try
        {
            var temp = Path.Combine(baseDir, "data", "autostart.vbs");
            Directory.CreateDirectory(Path.GetDirectoryName(temp) ?? baseDir);
            File.WriteAllText(temp, vbs, Encoding.Unicode);
            var info = new ProcessStartInfo("cmd.exe", "/c copy /y \"" + temp + "\" \"" + script + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            using (var p = Process.Start(info))
            {
                p.WaitForExit(10000);
            }
            if (File.Exists(script))
            {
                trace = "cmd copy ok";
                return true;
            }
            log.Append("cmdcopy:missing ");
        }
        catch (Exception ex)
        {
            log.Append("cmdcopy:" + ex.GetType().Name + " ");
        }

        try
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run"))
            {
                if (key != null)
                {
                    key.SetValue("ZhongyiWorkbench", "\"" + exe + "\" --background");
                    trace = "registry ok";
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            log.Append("registry:" + ex.GetType().Name + " ");
        }

        trace = log.ToString();
        return false;
    }

    [STAThread]
    private static int Main()
    {
        baseDir = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            var exe = Path.Combine(baseDir, "中医工作台.exe");
            if (!File.Exists(exe))
            {
                Show("请把「开机自启.exe」放在工作台文件夹里（和 中医工作台.exe 同一个目录）。");
                return 1;
            }

            var startupDir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var script = Path.Combine(startupDir, FileName);
            var vbs = string.Join("\r\n", new[]
            {
                "' 由「开机自启.exe」生成：登录后在后台把工作台服务准备好，不弹窗口。",
                "Set sh = CreateObject(\"WScript.Shell\")",
                "q = Chr(34)",
                "sh.Run q & \"" + exe + "\" & q & \" --background\", 0, False",
                ""
            });
            Log("startup=" + startupDir + " exe=" + exe);

#if REMOVE
            var removed = false;
            try
            {
                if (File.Exists(script))
                {
                    File.Delete(script);
                    removed = true;
                }
            }
            catch (Exception ex)
            {
                Log("delete failed: " + ex.Message);
            }
            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null) key.DeleteValue("ZhongyiWorkbench", false);
                }
            }
            catch
            {
                // ignore
            }
            Log("remove scriptExists=" + File.Exists(script));
            Show(removed || !File.Exists(script) ? "已取消开机自启。" : "取消失败，请手动删除启动项。");
            return 0;
#else
            string trace;
            var ok = TryInstall(script, vbs, exe, out trace);
            Log("install ok=" + ok + " trace=" + trace + " exists=" + File.Exists(script));
            Show(ok
                ? "已设置开机自启：登录 Windows 后工作台会在后台准备好，点桌面图标即可秒开。\n\n想关闭时双击「取消自启.exe」。"
                : "设置失败：系统拒绝了写入启动项（" + trace + "）。\n可以改用「启动工作台.bat」手动启动。");
            return ok ? 0 : 1;
#endif
        }
        catch (Exception ex)
        {
            Log("exception: " + ex);
            Show("设置失败：" + ex.Message);
            return 1;
        }
    }
}
