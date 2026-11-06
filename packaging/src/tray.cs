// 工作台托盘：常驻通知区域，点一下打开工作台。
// - 启动时如果后台服务没起来，就悄悄用 start.mjs --background 拉起来
// - 右键菜单：打开工作台 / 停止服务 / 开机自启 / 退出
// - 支持命令行开关（自动化测试用）：--open 打开窗口后退出，--stop 停止服务后退出
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ZhongyiTray
{
    internal static class Program
    {
        private const string AppName = "中医诊疗工作台";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "ZhongyiWorkbenchTray";

        private static string baseDir;
        private static string nodeExe;
        private static string startScript;
        private static string stopScript;
        private static string iconPath;
        private static int port = 4310;
        private static NotifyIcon tray;
        private static ToolStripMenuItem openItem;
        private static ToolStripMenuItem stopItem;
        private static ToolStripMenuItem autostartItem;
        private static System.Windows.Forms.Timer healthTimer;
        private static bool stopping;

        [STAThread]
        private static void Main(string[] args)
        {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            nodeExe = Path.Combine(baseDir, "node.exe");
            startScript = Path.Combine(baseDir, "start.mjs");
            stopScript = Path.Combine(baseDir, "stop.mjs");
            iconPath = Path.Combine(baseDir, "app.ico");

            string portText = Environment.GetEnvironmentVariable("ZYB_PORT");
            int parsed;
            if (!string.IsNullOrEmpty(portText) && int.TryParse(portText, out parsed)) port = parsed;

            if (!File.Exists(nodeExe) || !File.Exists(startScript))
            {
                MessageBox.Show("缺少 node.exe 或 start.mjs。\n请把整个文件夹一起拷贝，不要只拷 exe。", AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            bool openOnly = HasArg(args, "--open");
            bool stopOnly = HasArg(args, "--stop");

            if (stopOnly)
            {
                StopServer();
                return;
            }
            if (openOnly)
            {
                EnsureRunning(false);
                OpenWindow();
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            BuildTray();
            EnsureRunning(true);
            Application.Run();
        }

        private static bool HasArg(string[] args, string flag)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void BuildTray()
        {
            tray = new NotifyIcon();
            if (File.Exists(iconPath))
            {
                try { tray.Icon = new Icon(iconPath); } catch { tray.Icon = SystemIcons.Application; }
            }
            else
            {
                tray.Icon = SystemIcons.Application;
            }
            tray.Text = AppName;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenWindow(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            openItem = new ToolStripMenuItem("打开工作台");
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            openItem.Click += delegate { OpenWindow(); };
            menu.Items.Add(openItem);

            stopItem = new ToolStripMenuItem("停止后台服务");
            stopItem.Click += delegate { StopServerWithConfirm(); };
            menu.Items.Add(stopItem);

            menu.Items.Add(new ToolStripSeparator());

            autostartItem = new ToolStripMenuItem("开机自启（登录后常驻托盘）");
            autostartItem.Checked = IsAutostartEnabled();
            autostartItem.Click += delegate { ToggleAutostart(); };
            menu.Items.Add(autostartItem);

            ToolStripMenuItem openDataItem = new ToolStripMenuItem("打开数据文件夹");
            openDataItem.Click += delegate
            {
                string dataDir = Path.Combine(baseDir, "data");
                if (Directory.Exists(dataDir)) Process.Start("explorer.exe", "\"" + dataDir + "\"");
            };
            menu.Items.Add(openDataItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出托盘");
            exitItem.Click += delegate
            {
                if (MessageBox.Show("退出托盘后，工作台后台服务也会停止。\n确定退出吗？", AppName,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                stopping = true;
                if (tray != null) tray.Visible = false;
                StopServer();
                Application.Exit();
            };
            menu.Items.Add(exitItem);

            tray.ContextMenuStrip = menu;

            healthTimer = new System.Windows.Forms.Timer();
            healthTimer.Interval = 5000;
            healthTimer.Tick += delegate { RefreshState(); };
            healthTimer.Start();
        }

        private static void RefreshState()
        {
            bool up = IsHealthy();
            if (openItem != null) openItem.Text = up ? "打开工作台" : "打开工作台（正在启动…）";
            if (stopItem != null) stopItem.Enabled = up;
            if (tray != null)
            {
                tray.Text = up ? AppName + "（运行中）" : AppName + "（未运行）";
            }
        }

        private static bool IsHealthy()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                request.Timeout = 2500;
                request.ReadWriteTimeout = 2500;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    return body.IndexOf("\"db\":true", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void EnsureRunning(bool showBalloon)
        {
            if (IsHealthy())
            {
                if (showBalloon) ShowBalloon("工作台已在后台运行，双击托盘图标即可打开。");
                return;
            }
            RunHidden(nodeExe, "\"" + startScript + "\" --background", null);
            for (int i = 0; i < 120; i++)
            {
                Thread.Sleep(500);
                if (IsHealthy()) break;
            }
            if (IsHealthy())
            {
                if (showBalloon) ShowBalloon("工作台已在后台运行，双击托盘图标即可打开。\n（第一次启动需要几秒）");
            }
            else
            {
                MessageBox.Show("后台服务没有起来。\n可以看看 data\\logs\\server.log，或双击「停止工作台.exe」后重试。",
                    AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static void OpenWindow()
        {
            if (!IsHealthy())
            {
                EnsureRunning(false);
                if (!IsHealthy()) return;
            }
            // start.mjs 发现服务已在跑，会直接开窗口然后退出
            RunHidden(nodeExe, "\"" + startScript + "\"", null);
        }

        private static void StopServerWithConfirm()
        {
            if (MessageBox.Show("停止后台服务后，需要再双击桌面图标或托盘「打开工作台」才会重新启动。\n确定停止吗？", AppName,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            StopServer();
            RefreshState();
        }

        private static void StopServer()
        {
            if (!File.Exists(stopScript)) return;
            try
            {
                RunHidden(nodeExe, "\"" + stopScript + "\"", "ZYB_SILENT=1");
                Thread.Sleep(2500);
            }
            catch
            {
            }
        }

        private static void ShowBalloon(string text)
        {
            if (tray == null) return;
            tray.BalloonTipTitle = AppName;
            tray.BalloonTipText = text;
            tray.ShowBalloonTip(4000);
        }

        private static void ToggleAutostart()
        {
            bool enable = !IsAutostartEnabled();
            string exePath = Path.Combine(baseDir, "工作台托盘.exe");
            string command = enable
                ? "New-ItemProperty -Path 'HKCU:\\" + RunKey + "' -Name '" + RunValue + "' -Value ('\"' + '" + exePath.Replace("'", "''") + "' + '\" --autostart') -PropertyType String -Force | Out-Null"
                : "Remove-ItemProperty -Path 'HKCU:\\" + RunKey + "' -Name '" + RunValue + "' -ErrorAction SilentlyContinue";
            try
            {
                RunHidden("powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"" + command + "\"", null);
                Thread.Sleep(400);
                bool now = IsAutostartEnabled();
                if (autostartItem != null) autostartItem.Checked = now;
                if (now == enable)
                {
                    ShowBalloon(enable ? "已开启：登录 Windows 后自动在托盘里待命。" : "已关闭开机自启。");
                }
                else
                {
                    MessageBox.Show("没能修改开机自启项（可能被系统策略拦住了）。\n可以改用文件夹里的「设置开机自启.bat」。",
                        AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("设置开机自启失败：" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static bool IsAutostartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    if (key == null) return false;
                    object value = key.GetValue(RunValue);
                    return value != null;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void RunHidden(string file, string arguments, string envName)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = file;
            info.Arguments = arguments;
            info.WorkingDirectory = baseDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            if (envName != null && envName.Length > 0)
            {
                int eq = envName.IndexOf('=');
                if (eq > 0) info.EnvironmentVariables[envName.Substring(0, eq)] = envName.Substring(eq + 1);
            }
            Process.Start(info);
        }
    }
}
