using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using Forms = System.Windows.Forms;

namespace ElloSetup
{
    public partial class MainWindow : Window
    {
        private const string AppFolderName = "ello smartTV";
        private const string ShortcutName = "ello smartTV.lnk";

        private string installDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppFolderName);
        private string installedExe;
        private bool busy;

        /// <summary>/auto: install straight away and exit (used by the CI smoke test).</summary>
        private readonly bool auto;

        public MainWindow()
        {
            InitializeComponent();
            var args = Environment.GetCommandLineArgs().Skip(1).ToArray();
            auto = args.Any(a => a.Equals("/auto", StringComparison.OrdinalIgnoreCase));
            var dirArg = args.FirstOrDefault(a => a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase));
            if (dirArg != null) installDir = dirArg.Substring(5);

            DirText.Text = installDir;
            DirText.ToolTip = installDir;

            if (!Payload.Load())
            {
                Fail("This setup file is damaged or incomplete. Please download it again.");
                InstallButton.IsEnabled = false;
                return;
            }
            VersionText.Text = "Version " + Payload.Version;
            if (auto) Loaded += (s, e) => OnInstall(this, null);
        }

        private async void OnInstall(object sender, RoutedEventArgs e)
        {
            if (busy) return;
            busy = true;
            ShowPage(ProgressPage);
            SetProgress(0);
            string tmp = null;
            try
            {
                tmp = Path.Combine(Path.GetTempPath(), "ello-smartTV-setup-" + Guid.NewGuid().ToString("N") + ".exe");
                StatusText.Text = "Unpacking…";
                await Payload.ExtractTo(tmp, new Progress<double>(f => SetProgress(f * 0.15)));

                StatusText.Text = "Installing ello smartTV…";
                // NSIS: /S = silent; /D= must be last and unquoted.
                var proc = Process.Start(new ProcessStartInfo(tmp, "/S /D=" + installDir) { UseShellExecute = false });
                while (!proc.HasExited)
                {
                    await Task.Delay(200);
                    var f = Payload.InstalledSize > 0 ? Math.Min(0.99, (double)DirSize(installDir) / Payload.InstalledSize) : 0.5;
                    SetProgress(0.15 + 0.85 * f);
                }
                if (proc.ExitCode != 0)
                    throw new Exception("The installer stopped with code " + proc.ExitCode + ". If ello smartTV is open, close it and try again.");

                installedExe = Directory.Exists(installDir)
                    ? Directory.GetFiles(installDir, "*.exe")
                        .FirstOrDefault(p => !Path.GetFileName(p).StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase))
                    : null;
                if (installedExe == null) throw new Exception("ello smartTV wasn't found after installing. Please try again.");

                if (DesktopBox.IsChecked != true)
                {
                    var lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ShortcutName);
                    if (File.Exists(lnk)) File.Delete(lnk);
                }

                SetProgress(1);
                StatusText.Text = "Done";
                await Task.Delay(350);
                ShowPage(DonePage);
                LaunchButton.Focus();
                if (auto) Application.Current.Shutdown(0);
            }
            catch (Exception ex)
            {
                Fail(ex.Message);
                if (auto) Application.Current.Shutdown(1);
            }
            finally
            {
                if (tmp != null) try { File.Delete(tmp); } catch { /* still in use; temp gets cleaned up */ }
                busy = false;
            }
        }

        private void OnLaunch(object sender, RoutedEventArgs e)
        {
            if (installedExe != null)
                Process.Start(new ProcessStartInfo(installedExe) { UseShellExecute = true, WorkingDirectory = installDir });
            Close();
        }

        private void OnBrowse(object sender, RoutedEventArgs e)
        {
            using (var dlg = new Forms.FolderBrowserDialog { Description = "Choose where to install ello smartTV", SelectedPath = installDir })
            {
                if (dlg.ShowDialog() != Forms.DialogResult.OK) return;
                var dir = dlg.SelectedPath;
                // Picking e.g. "D:\Apps" installs into "D:\Apps\ello smartTV".
                if (!string.Equals(Path.GetFileName(dir.TrimEnd('\\')), AppFolderName, StringComparison.OrdinalIgnoreCase))
                    dir = Path.Combine(dir, AppFolderName);
                installDir = dir;
                DirText.Text = dir;
                DirText.ToolTip = dir;
            }
        }

        private void OnClose(object sender, RoutedEventArgs e)
        {
            if (busy) return; // don't leave a half-finished install
            Close();
        }

        private void OnMinimize(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void OnDrag(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left) DragMove();
        }

        private void Fail(string message)
        {
            ErrorText.Text = message;
            ShowPage(ErrorPage);
        }

        /// <summary>Cross-fade to one of the pages.</summary>
        private void ShowPage(FrameworkElement page)
        {
            foreach (var p in new FrameworkElement[] { WelcomePage, ProgressPage, DonePage, ErrorPage })
                p.Visibility = p == page ? Visibility.Visible : Visibility.Collapsed;
            page.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)));
        }

        private void SetProgress(double f)
        {
            var width = ((FrameworkElement)ProgressFill.Parent).ActualWidth * Math.Max(0, Math.Min(1, f));
            ProgressFill.BeginAnimation(WidthProperty,
                new DoubleAnimation(width, TimeSpan.FromMilliseconds(250)) { EasingFunction = new QuadraticEase() });
            PercentText.Text = Math.Round(f * 100) + "%";
        }

        private static long DirSize(string dir)
        {
            if (!Directory.Exists(dir)) return 0;
            long total = 0;
            try
            {
                foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { total += new FileInfo(f).Length; } catch { /* file being written */ }
                }
            }
            catch { /* folder changing under us */ }
            return total;
        }
    }
}
