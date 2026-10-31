using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class Launcher
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    private static void Fail(string message)
    {
        MessageBoxW(IntPtr.Zero, message, "中医工作台", 0x00000010u);
    }

    [STAThread]
    private static int Main()
    {
        try
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var node = Path.Combine(baseDir, "node.exe");
            var script = Path.Combine(baseDir, "start.mjs");

            if (!File.Exists(node))
            {
                Fail("缺少 node.exe，请把整个文件夹一起拷贝（不能只拷这个 exe）。\n\n目录：" + baseDir);
                return 1;
            }
            if (!File.Exists(script))
            {
                Fail("缺少 start.mjs，请把整个文件夹一起拷贝。\n\n目录：" + baseDir);
                return 1;
            }

            var info = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "\"" + script + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            using (var child = Process.Start(info))
            {
                if (child == null)
                {
                    Fail("启动失败：无法创建后台进程。");
                    return 1;
                }
                child.WaitForExit();
            }
            return 0;
        }
        catch (Exception ex)
        {
            Fail("启动失败：" + ex.Message);
            return 1;
        }
    }
}
