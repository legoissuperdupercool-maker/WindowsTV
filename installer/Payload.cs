using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace ElloSetup
{
    /// <summary>
    /// The real (NSIS) installer is appended to this exe by
    /// scripts/build-custom-installer.ps1, followed by a 56-byte trailer:
    /// version (32 bytes ASCII) · installed size (int64) · payload length (int64) · "ELLOPKG1".
    /// </summary>
    internal static class Payload
    {
        private const string Magic = "ELLOPKG1";
        private const int TrailerSize = 56;

        public static string Version { get; private set; } = "";
        /// <summary>Total size of the installed app, used to estimate progress.</summary>
        public static long InstalledSize { get; private set; }
        private static long offset;
        private static long length;

        public static bool Load()
        {
            var self = Assembly.GetExecutingAssembly().Location;
            using (var fs = File.OpenRead(self))
            {
                if (fs.Length < TrailerSize) return false;
                var buf = new byte[TrailerSize];
                fs.Seek(-TrailerSize, SeekOrigin.End);
                if (fs.Read(buf, 0, TrailerSize) != TrailerSize) return false;
                if (Encoding.ASCII.GetString(buf, 48, 8) != Magic) return false;
                Version = Encoding.ASCII.GetString(buf, 0, 32).TrimEnd('\0', ' ');
                InstalledSize = BitConverter.ToInt64(buf, 32);
                length = BitConverter.ToInt64(buf, 40);
                offset = fs.Length - TrailerSize - length;
                return offset > 0;
            }
        }

        /// <summary>Copy the embedded installer to <paramref name="dest"/>, reporting 0..1.</summary>
        public static async Task ExtractTo(string dest, IProgress<double> progress)
        {
            var self = Assembly.GetExecutingAssembly().Location;
            using (var src = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20, true))
            using (var dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, true))
            {
                src.Seek(offset, SeekOrigin.Begin);
                var buf = new byte[4 << 20];
                long done = 0;
                while (done < length)
                {
                    var n = await src.ReadAsync(buf, 0, (int)Math.Min(buf.Length, length - done));
                    if (n <= 0) throw new EndOfStreamException("The setup file is incomplete. Please download it again.");
                    await dst.WriteAsync(buf, 0, n);
                    done += n;
                    progress.Report((double)done / length);
                }
            }
        }
    }
}
