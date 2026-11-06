// 中医诊疗工作台 —— 免管理员安装器 / 卸载器（WinForms，C# 5 语法）
//
// 编译（系统自带 .NET Framework 4.x 的 csc，见 scripts/build-installer.mjs）：
//   csc /target:winexe /codepage:65001 ... setup.cs                        -> 安装中医工作台.exe
//   csc /target:winexe /codepage:65001 /define:UNINSTALL ... setup.cs      -> 卸载.exe
//
// 约定：
//   * 安装目录默认 %LOCALAPPDATA%\Programs\中医工作台，只写 HKCU 与 %LOCALAPPDATA%，不需要管理员权限。
//   * 运行参数：/silent 静默、/dir=<目录> 指定目标、/launch 安装后打开、/purge 卸载时删除全部数据。
//   * 卸载入口：exe 文件名含「卸载」或参数含 /uninstall（安装时会把自身复制成 目标\卸载.exe）。
//   * 静默模式不弹任何窗口（失败时退出码 1，日志写在 %TEMP%\zhongyi-workbench-setup.log）。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = HasArg(args, "/silent") || HasArg(args, "-silent") || HasArg(args, "--silent") || HasArg(args, "/s");
        bool uninstall = HasArg(args, "/uninstall") || HasArg(args, "-uninstall") || HasArg(args, "--uninstall") || HasArg(args, "/u");
        bool purge = HasArg(args, "/purge") || HasArg(args, "/delete-data") || HasArg(args, "-purge");
        bool openAfter = HasArg(args, "/launch") || HasArg(args, "/open");

        string dirOverride = ArgValue(args, "/dir=", "/dir");
        if (dirOverride == null) dirOverride = ArgValue(args, "--dir=", "--dir");
        if (dirOverride != null)
        {
            dirOverride = dirOverride.Trim().Trim('"');
            if (dirOverride.Length == 0) dirOverride = null;
        }

        // 安装器会被复制成「卸载.exe」，靠文件名识别卸载模式
        if (!uninstall)
        {
            try
            {
                string exeName = Path.GetFileName(Application.ExecutablePath);
                if (exeName.IndexOf("卸载", StringComparison.Ordinal) >= 0) uninstall = true;
            }
            catch
            {
                // 取不到自身路径就按安装处理
            }
        }
#if UNINSTALL
        uninstall = true;
#endif

        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
        }
        catch
        {
            // 视觉样式失败不影响功能
        }

        try
        {
            if (uninstall)
            {
                return Uninstaller.Run(silent, purge, dirOverride);
            }
            return Installer.Run(silent, dirOverride, openAfter);
        }
        catch (Exception ex)
        {
            Logger.Write("未处理异常：" + ex);
            Reporter.Fail("程序发生异常：" + ex.Message + "\n\n日志：" + Logger.FilePath, silent);
            return 1;
        }
    }

    private static bool HasArg(string[] args, string name)
    {
        for (int i = 0; i < args.Length; i++)
        {
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string ArgValue(string[] args, string prefix, string separateName)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg == null) continue;
            if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return arg.Substring(prefix.Length);
            if (string.Equals(arg, separateName, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) return args[i + 1];
        }
        return null;
    }
}

internal static class Logger
{
    private static readonly object SyncRoot = new object();
    public static readonly string FilePath = Path.Combine(Path.GetTempPath(), "zhongyi-workbench-setup.log");

    public static void Write(string line)
    {
        try
        {
            lock (SyncRoot)
            {
                File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch
        {
            // 日志写不进去不能影响安装
        }
    }
}

internal static class Reporter
{
    public static void Fail(string message, bool silent)
    {
        Logger.Write("失败：" + Flatten(message));
        if (!silent)
        {
            MessageBox.Show(message, "中医诊疗工作台", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    public static void Info(string message, bool silent)
    {
        if (!silent)
        {
            MessageBox.Show(message, "中医诊疗工作台", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private static string Flatten(string text)
    {
        if (text == null) return "";
        return text.Replace("\r", " ").Replace("\n", " | ");
    }
}

internal interface IProgressSink
{
    void Report(int percent, string message);
    void Marquee(string message);
}

internal sealed class NullProgress : IProgressSink
{
    public void Report(int percent, string message)
    {
        Logger.Write("[" + percent + "%] " + message);
    }

    public void Marquee(string message)
    {
        Logger.Write(message);
    }
}

internal sealed class FormProgress : IProgressSink
{
    private readonly ProgressForm form;

    public FormProgress(ProgressForm form)
    {
        this.form = form;
    }

    public void Report(int percent, string message)
    {
        if (form == null || form.IsDisposed) return;
        form.Report(percent, message);
    }

    public void Marquee(string message)
    {
        if (form == null || form.IsDisposed) return;
        form.Marquee(message);
    }
}

internal sealed class ProgressForm : Form
{
    private readonly Label statusLabel;
    private readonly ProgressBar progressBar;

    public ProgressForm(string title)
    {
        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        ShowInTaskbar = true;
        TopMost = true;
        ClientSize = new Size(560, 142);
        BackColor = Color.White;
        Font = SystemFonts.MessageBoxFont;

        statusLabel = new Label();
        statusLabel.AutoSize = false;
        statusLabel.Location = new Point(20, 20);
        statusLabel.Size = new Size(520, 48);
        statusLabel.Text = "正在准备…";

        progressBar = new ProgressBar();
        progressBar.Location = new Point(20, 82);
        progressBar.Size = new Size(520, 24);
        progressBar.Minimum = 0;
        progressBar.Maximum = 100;
        progressBar.Value = 0;

        Controls.Add(statusLabel);
        Controls.Add(progressBar);
    }

    public void Report(int percent, string message)
    {
        if (IsDisposed) return;
        statusLabel.Text = message;
        progressBar.Style = ProgressBarStyle.Continuous;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        progressBar.Value = percent;
        Update();
        Application.DoEvents();
    }

    public void Marquee(string message)
    {
        if (IsDisposed) return;
        statusLabel.Text = message;
        progressBar.Style = ProgressBarStyle.Marquee;
        Update();
        Application.DoEvents();
    }
}

internal sealed class InstallDoneForm : Form
{
    private readonly CheckBox launchCheck;

    public bool LaunchChecked
    {
        get { return launchCheck.Checked; }
    }

    public InstallDoneForm(string message, bool canLaunch)
    {
        Text = "安装完成";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(560, 290);
        Font = SystemFonts.MessageBoxFont;

        Label label = new Label();
        label.AutoSize = false;
        label.Location = new Point(18, 16);
        label.Size = new Size(524, 190);
        label.Text = message;

        launchCheck = new CheckBox();
        launchCheck.Text = "安装后立即打开工作台";
        launchCheck.Location = new Point(20, 212);
        launchCheck.Size = new Size(320, 26);
        launchCheck.Checked = true;
        launchCheck.Visible = canLaunch;

        Button ok = new Button();
        ok.Text = "完成";
        ok.Location = new Point(424, 244);
        ok.Size = new Size(116, 32);
        ok.DialogResult = DialogResult.OK;

        Controls.Add(label);
        Controls.Add(launchCheck);
        Controls.Add(ok);
        AcceptButton = ok;
    }
}

internal sealed class UninstallConfirmForm : Form
{
    private readonly CheckBox purgeCheck;

    public bool PurgeData
    {
        get { return purgeCheck.Checked; }
    }

    public UninstallConfirmForm(string target)
    {
        Text = "卸载中医诊疗工作台";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(580, 320);
        Font = SystemFonts.MessageBoxFont;

        Label label = new Label();
        label.AutoSize = false;
        label.Location = new Point(18, 16);
        label.Size = new Size(544, 170);
        label.Text =
            "即将卸载「中医诊疗工作台」。\n\n" +
            "安装位置：\n" + target + "\n\n" +
            "默认会保留病案数据库与上传的附件、备份：\n" +
            "  · 安装目录\\prisma\\dev.db\n" +
            "  · 安装目录\\data\\uploads\n" +
            "  · 安装目录\\data\\backups\n\n" +
            "只删除程序文件，需要时可以重新安装后继续使用这些数据。";

        purgeCheck = new CheckBox();
        purgeCheck.Text = "同时删除全部数据（数据库、上传附件与备份，删除后无法恢复）";
        purgeCheck.Location = new Point(20, 196);
        purgeCheck.Size = new Size(540, 26);
        purgeCheck.Checked = false;

        Button uninstallButton = new Button();
        uninstallButton.Text = "卸载";
        uninstallButton.Location = new Point(340, 252);
        uninstallButton.Size = new Size(110, 32);
        uninstallButton.DialogResult = DialogResult.OK;

        Button cancelButton = new Button();
        cancelButton.Text = "取消";
        cancelButton.Location = new Point(458, 252);
        cancelButton.Size = new Size(100, 32);
        cancelButton.DialogResult = DialogResult.Cancel;

        Controls.Add(label);
        Controls.Add(purgeCheck);
        Controls.Add(uninstallButton);
        Controls.Add(cancelButton);
        AcceptButton = uninstallButton;
        CancelButton = cancelButton;
    }
}

internal static class AppPaths
{
    public const string FolderName = "中医工作台";
    public const string ShortcutName = "中医工作台.lnk";

    public static string DefaultInstallDir()
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrEmpty(local))
        {
            local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Local");
        }
        return Path.Combine(Path.Combine(local, "Programs"), FolderName);
    }

    public static string DesktopShortcut()
    {
        string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop");
        if (!Directory.Exists(desktop))
        {
            desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }
        return Path.Combine(desktop, ShortcutName);
    }

    public static string StartMenuShortcut()
    {
        string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft", "Windows", "Start Menu", "Programs");
        return Path.Combine(programs, ShortcutName);
    }
}

internal static class Shortcuts
{
    // 通过 powershell 的 WScript.Shell 建 .lnk：C# 直接调 COM 在某些目录（如启动）会 UnauthorizedAccessException
    public static void Create(string lnkPath, string targetExe, string workingDir, string iconPath)
    {
        string dir = Path.GetDirectoryName(lnkPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        // 注意：不要用 powershell -EncodedCommand —— 某些机器（安全软件）会把它挂起，
        // 改为把脚本写入临时 .ps1（UTF-8 带 BOM，保证中文路径正确）再用 -File 执行。
        string script =
            "$ErrorActionPreference='Stop'\r\n" +
            "$w=New-Object -ComObject WScript.Shell\r\n" +
            "$s=$w.CreateShortcut('" + PsQuote(lnkPath) + "')\r\n" +
            "$s.TargetPath='" + PsQuote(targetExe) + "'\r\n" +
            "$s.WorkingDirectory='" + PsQuote(workingDir) + "'\r\n" +
            "$s.IconLocation='" + PsQuote(iconPath) + "'\r\n" +
            "$s.Description='中医诊疗工作台'\r\n" +
            "$s.Save()\r\n" +
            "if (-not (Test-Path -LiteralPath '" + PsQuote(lnkPath) + "')) { throw '快捷方式文件未生成' }\r\n";

        string ps1 = Path.Combine(Path.GetTempPath(), "zyb-shortcut-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            File.WriteAllText(ps1, script, new UTF8Encoding(true));
        }
        catch (Exception ex)
        {
            throw new Exception("无法写入快捷方式脚本：" + ps1 + "\n" + ex.Message, ex);
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        string stdout = "";
        string stderr = "";
        int exitCode = -1;
        try
        {
            using (Process process = Process.Start(psi))
            {
                if (process == null) throw new Exception("无法启动 powershell.exe 创建快捷方式。");

                StringBuilder outBuffer = new StringBuilder();
                StringBuilder errBuffer = new StringBuilder();
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) outBuffer.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) errBuffer.AppendLine(e.Data);
                };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (!process.WaitForExit(45000))
                {
                    try { process.Kill(); } catch { }
                    throw new Exception("创建快捷方式超时（45 秒）：\n" + lnkPath);
                }
                process.WaitForExit();
                exitCode = process.ExitCode;
                stdout = outBuffer.ToString();
                stderr = errBuffer.ToString();
            }
        }
        finally
        {
            try { File.Delete(ps1); } catch { }
        }

        Logger.Write("创建快捷方式 " + lnkPath + " exit=" + exitCode + " out=" + Flatten(stdout) + " err=" + Flatten(stderr));
        if (!File.Exists(lnkPath))
        {
            throw new Exception("创建快捷方式失败：\n" + lnkPath + "\n\npowershell 退出码：" + exitCode +
                (stderr.Length > 0 ? "\n" + stderr.Trim() : ""));
        }
    }

    public static void Delete(string lnkPath)
    {
        try
        {
            if (File.Exists(lnkPath))
            {
                File.Delete(lnkPath);
                Logger.Write("已删除快捷方式：" + lnkPath);
            }
        }
        catch (Exception ex)
        {
            Logger.Write("删除快捷方式失败（忽略）：" + lnkPath + " -> " + ex.Message);
        }
    }

    private static string PsQuote(string value)
    {
        return value.Replace("'", "''");
    }

    private static string Flatten(string text)
    {
        if (text == null) return "";
        return text.Replace("\r", " ").Replace("\n", " | ").Trim();
    }
}

internal static class RegistryInfo
{
    public const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhongyiWorkbench";
    public const string DisplayName = "中医诊疗工作台";
    public const string DisplayVersion = "1.0";
    public const string Publisher = "杏林堂";

    public static void Write(string target, string exePath)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(KeyPath))
        {
            if (key == null) throw new Exception("无法创建卸载注册表项：HKCU\\" + KeyPath);
            key.SetValue("DisplayName", DisplayName, RegistryValueKind.String);
            key.SetValue("DisplayVersion", DisplayVersion, RegistryValueKind.String);
            key.SetValue("Publisher", Publisher, RegistryValueKind.String);
            key.SetValue("InstallLocation", target, RegistryValueKind.String);
            key.SetValue("DisplayIcon", exePath, RegistryValueKind.String);
            key.SetValue("UninstallString", "\"" + Path.Combine(target, "卸载.exe") + "\"", RegistryValueKind.String);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);

            int sizeKb = DirectorySizeKb(target);
            if (sizeKb > 0) key.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
        }
        Logger.Write("已写入卸载信息：HKCU\\" + KeyPath);
    }

    public static void Delete()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(KeyPath, false);
            Logger.Write("已删除卸载信息：HKCU\\" + KeyPath);
        }
        catch (Exception ex)
        {
            Logger.Write("删除卸载信息失败（忽略）：" + ex.Message);
        }
    }

    private static int DirectorySizeKb(string dir)
    {
        try
        {
            long total = 0;
            string[] files = Directory.GetFiles(dir, "*", SearchOption.AllDirectories);
            for (int i = 0; i < files.Length; i++)
            {
                try
                {
                    total += new FileInfo(files[i]).Length;
                }
                catch
                {
                    // 个别文件取不到大小就跳过
                }
            }
            long kb = total / 1024;
            if (kb < 1) kb = 1;
            if (kb > int.MaxValue) kb = int.MaxValue;
            return (int)kb;
        }
        catch
        {
            return 0;
        }
    }
}

internal static class Services
{
    // 运行目标目录里的「停止工作台.exe」关掉 node 服务，再清掉还占用该目录的进程
    public static void StopExisting(string target, IProgressSink progress)
    {
        string stopper = Path.Combine(target, "停止工作台.exe");
        if (File.Exists(stopper))
        {
            progress.Report(6, "正在停止工作台服务…");
            Logger.Write("运行停止程序：" + stopper);
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = stopper;
                psi.WorkingDirectory = target;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.EnvironmentVariables["ZYB_SILENT"] = "1";
                using (Process process = Process.Start(psi))
                {
                    if (process != null) process.WaitForExit(20000);
                }
            }
            catch (Exception ex)
            {
                Logger.Write("停止程序运行失败（忽略）：" + ex.Message);
            }
            Thread.Sleep(2500);
        }
        KillProcessesUnder(target);
    }

    public static void KillProcessesUnder(string dir)
    {
        string prefix;
        try
        {
            prefix = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
        }
        catch
        {
            return;
        }

        int selfId;
        try
        {
            selfId = Process.GetCurrentProcess().Id;
        }
        catch
        {
            selfId = -1;
        }

        Process[] all;
        try
        {
            all = Process.GetProcesses();
        }
        catch
        {
            return;
        }

        for (int i = 0; i < all.Length; i++)
        {
            Process process = all[i];
            try
            {
                if (process.Id == selfId) continue;
                string path = process.MainModule.FileName;
                if (path != null && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    Logger.Write("结束占用进程：" + path + " (pid " + process.Id + ")");
                    process.Kill();
                }
            }
            catch
            {
                // 系统进程或权限不足，跳过
            }
            finally
            {
                try
                {
                    process.Dispose();
                }
                catch
                {
                }
            }
        }
    }

    public static void ForceRemoveDirectory(string dir)
    {
        if (!Directory.Exists(dir)) return;
        Exception last = null;
        for (int attempt = 0; attempt < 12; attempt++)
        {
            try
            {
                Directory.Delete(dir, true);
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                if (attempt == 2) KillProcessesUnder(dir);
                Thread.Sleep(500);
            }
        }
        throw new Exception("无法删除旧目录（可能仍有程序占用）：\n" + dir +
            (last == null ? "" : "\n" + last.Message));
    }

    public static void TryDeleteEntry(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, true);
            else if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex)
        {
            Logger.Write("删除失败（忽略）：" + path + " -> " + ex.Message);
        }
    }

    // 保留数据卸载：prisma\dev.db 与 data\uploads、data\backups 不动
    public static void DeleteProgramFilesKeepData(string target, string selfPath)
    {
        if (!Directory.Exists(target)) return;
        string[] entries = Directory.GetFileSystemEntries(target);
        for (int i = 0; i < entries.Length; i++)
        {
            string entry = entries[i];
            if (IsSamePath(entry, selfPath)) continue;
            string name = Path.GetFileName(entry).ToLowerInvariant();
            if (name == "prisma")
            {
                DeleteChildrenExcept(entry, new string[] { "dev.db" });
            }
            else if (name == "data")
            {
                DeleteChildrenExcept(entry, new string[] { "uploads", "backups" });
            }
            else
            {
                TryDeleteEntry(entry);
            }
        }
    }

    public static void DeleteAllChildren(string target, string selfPath)
    {
        if (!Directory.Exists(target)) return;
        string[] entries = Directory.GetFileSystemEntries(target);
        for (int i = 0; i < entries.Length; i++)
        {
            if (IsSamePath(entries[i], selfPath)) continue;
            TryDeleteEntry(entries[i]);
        }
    }

    public static bool IsSamePath(string left, string right)
    {
        try
        {
            return string.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'),
                StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void DeleteChildrenExcept(string dir, string[] keepNames)
    {
        if (!Directory.Exists(dir)) return;
        string[] entries = Directory.GetFileSystemEntries(dir);
        for (int i = 0; i < entries.Length; i++)
        {
            string name = Path.GetFileName(entries[i]).ToLowerInvariant();
            bool keep = false;
            for (int k = 0; k < keepNames.Length; k++)
            {
                if (name == keepNames[k])
                {
                    keep = true;
                    break;
                }
            }
            if (!keep) TryDeleteEntry(entries[i]);
        }
    }
}

internal static class Installer
{
    public static int Run(bool silent, string dirOverride, bool forceLaunch)
    {
        string baseDir = Path.GetDirectoryName(Application.ExecutablePath);
        string payload = Path.Combine(baseDir, "payload.zip");
        string target = string.IsNullOrEmpty(dirOverride) ? AppPaths.DefaultInstallDir() : Path.GetFullPath(dirOverride);

        Logger.Write("开始安装 silent=" + silent + " target=" + target + " base=" + baseDir);
        if (!File.Exists(payload))
        {
            Reporter.Fail("找不到安装数据文件：\n" + payload +
                "\n\n请把「安装中医工作台.exe」和「payload.zip」放在同一个文件夹里再运行。", silent);
            return 1;
        }

        bool targetExists = Directory.Exists(target);
        if (targetExists && !silent)
        {
            DialogResult answer = MessageBox.Show(
                "目标位置已经存在工作台：\n\n" + target +
                "\n\n要覆盖安装吗？\n（覆盖会先关闭旧程序，然后删除整个旧目录，原有数据也会被清空，请先自行备份）",
                "中医诊疗工作台 - 覆盖安装",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes)
            {
                Logger.Write("用户取消了覆盖安装");
                return 0;
            }
        }

        ProgressForm form = null;
        IProgressSink progress;
        if (silent)
        {
            progress = new NullProgress();
        }
        else
        {
            form = new ProgressForm("正在安装中医诊疗工作台");
            form.Show();
            form.Activate();
            form.Refresh();
            Application.DoEvents();
            progress = new FormProgress(form);
        }

        string exePath = Path.Combine(target, "中医工作台.exe");
        try
        {
            progress.Report(3, "正在准备安装…");

            if (targetExists)
            {
                Services.StopExisting(target, progress);
                progress.Report(12, "正在删除旧版本…");
                Services.ForceRemoveDirectory(target);
            }

            progress.Report(16, "正在创建安装目录…");
            Directory.CreateDirectory(target);

            ExtractPayload(payload, target, progress);
            progress.Report(72, "正在整理安装文件…");
            FlattenSingleFolder(target);

            progress.Report(78, "正在创建快捷方式…");
            string iconPath = Path.Combine(target, "app.ico");
            if (!File.Exists(iconPath)) iconPath = exePath;
            Shortcuts.Create(AppPaths.DesktopShortcut(), exePath, target, iconPath);
            Shortcuts.Create(AppPaths.StartMenuShortcut(), exePath, target, iconPath);

            progress.Report(87, "正在写入卸载信息…");
            RegistryInfo.Write(target, exePath);

            progress.Report(94, "正在准备卸载程序…");
            CopyUninstaller(target, baseDir);

            progress.Report(100, "安装完成");
            Logger.Write("安装成功：" + target);
        }
        catch (Exception ex)
        {
            Logger.Write("安装失败：" + ex);
            if (form != null)
            {
                form.Close();
                form = null;
            }
            Reporter.Fail("安装失败：" + ex.Message + "\n\n安装位置：" + target +
                "\n\n可以整理后重试；日志：" + Logger.FilePath, silent);
            return 1;
        }

        if (form != null)
        {
            form.Close();
            form = null;
        }

        bool launch = forceLaunch;
        if (!silent)
        {
            string message =
                "安装完成！\n\n安装位置：\n" + target +
                "\n\n可以从桌面或开始菜单打开「中医诊疗工作台」。\n" +
                "数据保存在安装目录的 prisma\\dev.db 与 data\\ 下。\n\n" +
                "以后要卸载：运行安装目录里的「卸载.exe」，或打开\n" +
                "Windows「设置 → 应用 → 安装的应用」找到「中医诊疗工作台」卸载。";
            using (InstallDoneForm done = new InstallDoneForm(message, File.Exists(exePath)))
            {
                done.ShowDialog();
                launch = done.LaunchChecked;
            }
        }

        if (launch) LaunchApp(target);
        Logger.Write("安装流程结束 launch=" + launch);
        return 0;
    }

    private static void ExtractPayload(string payload, string target, IProgressSink progress)
    {
        progress.Marquee("正在解压安装文件（文件较多，需要几分钟）…");
        Logger.Write("开始解压：" + payload);

        Exception[] failure = new Exception[1];
        bool[] finished = new bool[1];
        Thread worker = new Thread(delegate()
        {
            try
            {
                ZipFile.ExtractToDirectory(payload, target);
            }
            catch (Exception ex)
            {
                failure[0] = ex;
            }
            finally
            {
                finished[0] = true;
            }
        });
        worker.IsBackground = true;
        worker.Start();

        while (!finished[0])
        {
            Application.DoEvents();
            Thread.Sleep(50);
        }
        worker.Join();

        if (failure[0] != null)
        {
            throw new Exception("解压安装文件失败：" + failure[0].Message, failure[0]);
        }
        progress.Report(70, "解压完成");
    }

    // payload.zip 顶层如果只有一层目录，则把这一层的内容上提到安装目录
    private static void FlattenSingleFolder(string target)
    {
        string[] entries = Directory.GetFileSystemEntries(target);
        if (entries.Length != 1) return;
        string only = entries[0];
        if (!Directory.Exists(only)) return;

        Logger.Write("检测到单层目录，上提内容：" + only);
        string[] files = Directory.GetFiles(only);
        for (int i = 0; i < files.Length; i++)
        {
            File.Move(files[i], Path.Combine(target, Path.GetFileName(files[i])));
        }
        string[] dirs = Directory.GetDirectories(only);
        for (int i = 0; i < dirs.Length; i++)
        {
            Directory.Move(dirs[i], Path.Combine(target, Path.GetFileName(dirs[i])));
        }
        Directory.Delete(only, true);
    }

    private static void CopyUninstaller(string target, string baseDir)
    {
        string self = Path.GetFullPath(Application.ExecutablePath);
        string dest = Path.Combine(target, "卸载.exe");
        string sibling = Path.Combine(baseDir, "卸载.exe");

        try
        {
            if (File.Exists(dest)) File.Delete(dest);
        }
        catch
        {
            // 覆盖删除失败下面 Copy 会再报错
        }

        if (File.Exists(sibling) && !Services.IsSamePath(sibling, self))
        {
            File.Copy(sibling, dest, true);
            Logger.Write("已复制独立的卸载器：" + sibling + " -> " + dest);
        }
        else
        {
            File.Copy(self, dest, true);
            Logger.Write("已复制安装器自身作为卸载器：" + self + " -> " + dest);
        }

        try
        {
            File.SetAttributes(dest, FileAttributes.Normal);
        }
        catch
        {
        }
    }

    private static void LaunchApp(string target)
    {
        string tray = Path.Combine(target, "工作台托盘.exe");
        string exe = File.Exists(tray) ? tray : Path.Combine(target, "中医工作台.exe");
        if (!File.Exists(exe))
        {
            Logger.Write("没有找到可启动的程序，跳过自动打开：" + exe);
            return;
        }
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = exe;
            psi.WorkingDirectory = target;
            psi.UseShellExecute = true;
            Process.Start(psi);
            Logger.Write("已启动：" + exe);
        }
        catch (Exception ex)
        {
            Logger.Write("自动打开失败（忽略）：" + ex.Message);
        }
    }
}

internal static class Uninstaller
{
    public static int Run(bool silent, bool purge, string dirOverride)
    {
        string target;
        if (!string.IsNullOrEmpty(dirOverride))
        {
            target = Path.GetFullPath(dirOverride);
        }
        else
        {
            target = Path.GetDirectoryName(Application.ExecutablePath);
        }
        string selfPath = Path.GetFullPath(Application.ExecutablePath);
        bool targetExists = Directory.Exists(target);
        Logger.Write("开始卸载 silent=" + silent + " purge=" + purge + " target=" + target + " self=" + selfPath);

        if (!purge && !silent)
        {
            using (UninstallConfirmForm confirm = new UninstallConfirmForm(target))
            {
                if (confirm.ShowDialog() != DialogResult.OK)
                {
                    Logger.Write("用户取消了卸载");
                    return 0;
                }
                purge = confirm.PurgeData;
            }
        }

        ProgressForm form = null;
        IProgressSink progress;
        if (silent)
        {
            progress = new NullProgress();
        }
        else
        {
            form = new ProgressForm("正在卸载中医诊疗工作台");
            form.Show();
            form.Activate();
            form.Refresh();
            Application.DoEvents();
            progress = new FormProgress(form);
        }

        try
        {
            progress.Report(4, "正在停止工作台…");
            Services.StopExisting(target, progress);

            progress.Report(24, "正在删除快捷方式…");
            Shortcuts.Delete(AppPaths.DesktopShortcut());
            Shortcuts.Delete(AppPaths.StartMenuShortcut());

            progress.Report(36, "正在删除卸载信息…");
            RegistryInfo.Delete();

            progress.Report(46, "正在清理程序文件…");
            if (Directory.Exists(target))
            {
                if (purge) Services.DeleteAllChildren(target, selfPath);
                else Services.DeleteProgramFilesKeepData(target, selfPath);
            }

            progress.Report(92, "正在收尾…");
            ScheduleSelfDelete(target, purge, selfPath);
            progress.Report(100, "卸载完成");
            Logger.Write("卸载流程完成 purge=" + purge);
        }
        catch (Exception ex)
        {
            Logger.Write("卸载失败：" + ex);
            if (form != null)
            {
                form.Close();
                form = null;
            }
            Reporter.Fail("卸载失败：" + ex.Message + "\n\n安装位置：" + target +
                "\n\n日志：" + Logger.FilePath, silent);
            return 1;
        }

        if (form != null)
        {
            form.Close();
            form = null;
        }

        string message;
        if (purge)
        {
            message = "已卸载「中医诊疗工作台」，程序文件与全部数据都已删除。";
        }
        else if (!targetExists)
        {
            message = "没有找到安装目录，已清理快捷方式与卸载注册表信息。\n\n目录：" + target;
        }
        else
        {
            message = "已卸载「中医诊疗工作台」。\n\n程序文件已删除，病案数据已保留：\n" +
                Path.Combine(target, "prisma", "dev.db") + "\n" +
                Path.Combine(target, "data", "uploads") + "\n" +
                Path.Combine(target, "data", "backups") + "\n\n" +
                "如需彻底删除，可手动删除整个文件夹：\n" + target;
        }
        Reporter.Info(message, silent);
        return 0;
    }

    // Windows 不能删除正在运行的 exe：起一个延迟 cmd，等本进程退出后再删自身 / 删空目录
    private static void ScheduleSelfDelete(string target, bool purge, string selfPath)
    {
        bool selfInTarget = selfPath.StartsWith(Path.GetFullPath(target).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
        string command;
        if (purge)
        {
            command = "ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + target + "\"";
        }
        else if (selfInTarget)
        {
            command = "ping 127.0.0.1 -n 3 >nul & del /f /q \"" + selfPath + "\"";
        }
        else
        {
            return;
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = "/c " + command;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
            Process.Start(psi);
            Logger.Write("已安排退出后清理：" + command);
        }
        catch (Exception ex)
        {
            Logger.Write("安排退出后清理失败（忽略）：" + ex.Message);
        }
    }
}
