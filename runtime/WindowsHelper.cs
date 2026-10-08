// C# 5 / .NET Framework: native control helper compiled once by Windows PowerShell 5.1.
// Same actions, validation and JSON as runtime/windows-process.ps1, without starting
// PowerShell on every call. Any failure to build or run it falls back to that script.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace TestProgress {
    public static class WindowsHelper {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly string[] Names = {
            "Action", "JobFile", "ProcessId", "StartTime", "Owner", "JobName", "SessionId",
            "Directory", "Child", "Collector", "Runner", "Queries", "SelfProcessId", "Mode", "Cwd" };
        private static Dictionary<string, string> options;

        public static int Main(string[] args) {
            try {
                options = Parse(args);
                string action = Required("Action");
                switch (action) {
                    case "Identity": Write(Identity(Integer("ProcessId", 0))); return 0;
                    case "IdentityMany": case "StateMany": return Many(action);
                    case "State": Write(Map("state", WindowsProcessHost.State(Integer("ProcessId", 0), Optional("StartTime"), Optional("Owner")))); return 0;
                    case "Group": Write(Map("state", WindowsProcessHost.Group(Optional("JobName"), Integer("SessionId", -1)))); return 0;
                    case "Kill":
                        WindowsProcessHost.KillOwned(Integer("ProcessId", 0), Optional("StartTime"), Optional("Owner"));
                        Write(Map("killed", true)); return 0;
                    case "SecureDirectory": return SecureDirectory();
                    case "LaunchCoordinator": return LaunchCoordinator();
                    case "Run": return Run();
                    case "ResolveNode":
                        if (Required("Mode") != "project") throw new ArgumentException("ResolveNode supports the project mode only.");
                        Write(NodeDiscovery.SelectProject(Required("Cwd"))); return 0;
                    default: throw new ArgumentException("Unknown action.");
                }
            } catch (Exception error) {
                Console.Error.WriteLine("test-progress helper: " + error.Message);
                return 1;
            }
        }

        private static Dictionary<string, string> Parse(string[] args) {
            if (args.Length % 2 != 0) throw new ArgumentException("Options must be name/value pairs.");
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2) {
                string name = args[index].StartsWith("-", StringComparison.Ordinal) ? args[index].Substring(1) : null;
                if (name == null || Array.IndexOf(Names, name) < 0 || result.ContainsKey(name))
                    throw new ArgumentException("Unknown or repeated option.");
                result[name] = args[index + 1];
            }
            return result;
        }
        private static string Optional(string name) {
            string value;
            return options.TryGetValue(name, out value) ? value : null;
        }
        private static string Required(string name) {
            string value = Optional(name);
            if (String.IsNullOrEmpty(value)) throw new ArgumentException("Missing option " + name + ".");
            return value;
        }
        private static int Integer(string name, int fallback) {
            string value = Optional(name);
            if (value == null) return fallback;
            int result;
            if (!Int32.TryParse(value, System.Globalization.NumberStyles.AllowLeadingSign,
                System.Globalization.CultureInfo.InvariantCulture, out result)) throw new ArgumentException("Option " + name + " must be an integer.");
            return result;
        }

        private static Dictionary<string, object> Map(string key, object value) {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result[key] = value;
            return result;
        }
        // Field order matches the PowerShell serialization; callers compare identities as JSON.
        private static Dictionary<string, object> Identity(WindowsIdentity identity) {
            if (identity == null) return null;
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["platform"] = identity.platform;
            result["pid"] = identity.pid;
            result["startTime"] = identity.startTime;
            result["owner"] = identity.owner;
            result["sessionId"] = identity.sessionId;
            return result;
        }
        private static Dictionary<string, object> Identity(int pid) { return Identity(WindowsProcessHost.Identity(pid)); }
        // Written as UTF-8 to the raw handle: a helper started without a console cannot set its code page.
        private static void Write(object value) {
            byte[] bytes = new UTF8Encoding(false).GetBytes(Json.Serialize(value) + "\n");
            using (Stream output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
        }

        private static int Many(string action) {
            string queries = Optional("Queries");
            if (String.IsNullOrWhiteSpace(queries) || queries.Length > 65536 ||
                !queries.TrimStart().StartsWith("[", StringComparison.Ordinal) || !queries.TrimEnd().EndsWith("]", StringComparison.Ordinal))
                throw new ArgumentException("Windows queries must be a bounded JSON array.");
            object[] items = Json.DeserializeObject(queries) as object[];
            if (items == null) throw new ArgumentException("Windows queries must be a bounded JSON array.");
            if (items.Length > 64) throw new ArgumentException("Windows queries exceed 64 items.");
            bool state = action == "StateMany";
            // Validate every entry before invoking any native process query.
            foreach (object entry in items) {
                object pid = entry;
                IDictionary record = entry as IDictionary;
                if (state) pid = record == null ? null : record["pid"];
                if (!(pid is int) || (int)pid <= 0) throw new ArgumentException("Windows query PID must be a positive Int32.");
                if (state) {
                    string start = record["startTime"] as string, owner = record["owner"] as string;
                    if (start == null || !Regex.IsMatch(start, "^[0-9]{1,20}$") || owner == null || owner.Length > 184 ||
                        !Regex.IsMatch(owner, "^S-[0-9]+(?:-[0-9]+)+$")) throw new ArgumentException("Windows state query identity is invalid.");
                }
            }
            int self = Integer("SelfProcessId", 0);
            if (self < 0 || (self > 0 && !state)) throw new ArgumentException("Invalid self identity query.");
            List<object> results = new List<object>();
            foreach (object entry in items) {
                if (!state) {
                    try { results.Add(Identity((int)entry)); } catch { results.Add(null); }
                } else {
                    IDictionary record = (IDictionary)entry;
                    try { results.Add(WindowsProcessHost.State((int)record["pid"], (string)record["startTime"], (string)record["owner"]) == "present"); }
                    catch { results.Add(false); }
                }
            }
            if (!state) { Write(Map("identities", results)); return 0; }
            Dictionary<string, object> reply = Map("matches", results);
            object original = null;
            if (self > 0) { try { original = Identity(self); } catch { } }
            reply["selfIdentity"] = original;
            Write(reply);
            return 0;
        }

        private static void AssertAbsolute(string path) {
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) throw new ArgumentException("An absolute path is required.");
        }
        private static bool Reparse(FileSystemInfo item) { return (item.Attributes & FileAttributes.ReparsePoint) != 0; }
        private static void AssertNoReparse(DirectoryInfo ancestor) {
            for (; ancestor != null; ancestor = ancestor.Parent)
                if (Reparse(ancestor)) throw new InvalidOperationException("Reparse points are not allowed in a private state path.");
        }
        private static void AssertPrivatePath(string path) {
            AssertAbsolute(path);
            FileSystemInfo item;
            if (Directory.Exists(path)) item = new DirectoryInfo(path);
            else if (File.Exists(path)) item = new FileInfo(path);
            else throw new FileNotFoundException("Private state path is missing.");
            if (Reparse(item)) throw new InvalidOperationException("Reparse points are not allowed in a private state path.");
            AssertNoReparse(item is DirectoryInfo ? ((DirectoryInfo)item).Parent : ((FileInfo)item).Directory);
        }
        private static string ReadPrivateText(string path) {
            AssertPrivatePath(path);
            // Readers must permit atomic replacement of the pathname while retaining their handle.
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                if (stream.Length > 1048576) throw new InvalidOperationException("Private state exceeds size limit.");
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
            }
        }
        private static IDictionary ReadPrivateJson(string path) {
            IDictionary value = Json.DeserializeObject(ReadPrivateText(path)) as IDictionary;
            if (value == null) throw new InvalidOperationException("Private state is not a JSON object.");
            return value;
        }
        private static void WriteAtomicJson(string path, object value) {
            AssertPrivatePath(Path.GetDirectoryName(path));
            if (File.Exists(path)) AssertPrivatePath(path);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllText(temporary, Json.Serialize(value) + "\n", new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            } finally {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
        private static bool Is(object value, int expected) { return value is int && (int)value == expected; }

        private static string ProtectPrivateDirectory(string directory) {
            AssertAbsolute(directory);
            // Validate the existing chain before creation or any ACL change.
            bool existing = Directory.Exists(directory) || File.Exists(directory);
            string inspected = existing ? directory : Path.GetDirectoryName(Path.GetFullPath(directory));
            if (!Directory.Exists(inspected)) throw new InvalidOperationException("Private state path must be a directory.");
            AssertNoReparse(new DirectoryInfo(inspected));
            SecurityIdentifier user = new SecurityIdentifier(WindowsProcessHost.Identity(WindowsProcessHostSelf()).owner);
            SecurityIdentifier system = new SecurityIdentifier("S-1-5-18");
            if (!existing) WindowsProcessHost.CreatePrivateDirectory(directory, user.Value);
            DirectoryInfo item = new DirectoryInfo(directory);
            if (!item.Exists || Reparse(item)) throw new InvalidOperationException("Private state directory was substituted during creation.");
            AssertNoReparse(item);
            // Existing state must already be private; never take ownership or repair a
            // permissive directory that could contain another user's injected files.
            DirectorySecurity verified = Directory.GetAccessControl(directory);
            if (!user.Equals(verified.GetOwner(typeof(SecurityIdentifier)))) throw new InvalidOperationException("Private state directory has a different owner.");
            if (!verified.AreAccessRulesProtected) throw new InvalidOperationException("Private state ACL could not be verified.");
            AuthorizationRuleCollection rules = verified.GetAccessRules(true, true, typeof(SecurityIdentifier));
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (FileSystemAccessRule rule in rules) seen.Add(rule.IdentityReference.Value);
            if (rules.Count != 2 || seen.Count != 2) throw new InvalidOperationException("Private state ACL has unexpected entries.");
            foreach (FileSystemAccessRule rule in rules) {
                string identity = rule.IdentityReference.Value;
                if (rule.IsInherited || rule.AccessControlType != AccessControlType.Allow ||
                    rule.FileSystemRights != FileSystemRights.FullControl ||
                    rule.InheritanceFlags != (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit) ||
                    rule.PropagationFlags != PropagationFlags.None ||
                    (identity != user.Value && identity != system.Value)) throw new InvalidOperationException("Private state ACL has unexpected permissions.");
            }
            return user.Value;
        }
        private static int WindowsProcessHostSelf() { return System.Diagnostics.Process.GetCurrentProcess().Id; }
        private static int SecureDirectory() {
            string directory = Optional("Directory"), child = Optional("Child");
            string owner = ProtectPrivateDirectory(directory);
            if (child != null) {
                // The namespace root and its workspace directory are secured in one call.
                if (!String.Equals(Path.GetFullPath(Path.GetDirectoryName(child)), Path.GetFullPath(directory), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Private child directory must be directly under its root.");
                ProtectPrivateDirectory(child);
            }
            Dictionary<string, object> reply = Map("secured", true);
            reply["owner"] = owner;
            Write(reply);
            return 0;
        }

        private static int LaunchCoordinator() {
            string jobFile = Optional("JobFile"), collector = Optional("Collector"), runner = Optional("Runner");
            AssertAbsolute(jobFile);
            AssertPrivatePath(jobFile);
            AssertAbsolute(collector);
            if (!File.Exists(collector)) throw new InvalidOperationException("Collector executable is unavailable.");
            AssertAbsolute(runner);
            string coordinator = Path.Combine(runner, "module-batch-worker.mjs");
            if (!File.Exists(coordinator)) throw new InvalidOperationException("Coordinator script is unavailable.");
            IDictionary request = ReadPrivateJson(jobFile);
            Guid batch;
            if (!Is(request["schemaVersion"], 1) || !Guid.TryParse(request["batchId"] as string, out batch))
                throw new InvalidOperationException("Invalid coordinator request.");
            string directory = request["directory"] as string;
            AssertPrivatePath(directory);
            string expected = Path.Combine(directory, "batch." + batch.ToString("D") + ".request.json");
            if (!String.Equals(Path.GetFullPath(jobFile), Path.GetFullPath(expected), StringComparison.Ordinal))
                throw new InvalidOperationException("Coordinator request path does not match its identity.");
            // Same flag as LONG_LIVED_NODE_FLAGS in runner/runtime.mjs.
            Write(Identity(WindowsProcessHost.StartDetached(collector, new string[] { "--max-semi-space-size=1", coordinator, jobFile }, runner)));
            return 0;
        }

        private static bool CancelRequested(string cancelFile, string moduleId, string runId) {
            if (!File.Exists(cancelFile)) return false;
            AssertPrivatePath(cancelFile);
            IDictionary cancel = ReadPrivateJson(cancelFile);
            return Is(cancel["schemaVersion"], 1) && String.Equals(cancel["moduleId"] as string, moduleId, StringComparison.Ordinal) &&
                String.Equals(cancel["runId"] as string, runId, StringComparison.Ordinal);
        }
        private static int Run() {
            string jobFile = Optional("JobFile");
            AssertAbsolute(jobFile);
            AssertPrivatePath(jobFile);
            if (new FileInfo(jobFile).Length > 1048576) throw new InvalidOperationException("Private job exceeds size limit.");
            IDictionary job = ReadPrivateJson(jobFile);
            string moduleId = job["moduleId"] as string;
            if (!Is(job["schemaVersion"], 1) || moduleId == null || !Regex.IsMatch(moduleId, "^[a-z][a-z0-9-]{0,47}$") ||
                Array.IndexOf(new[] { "all", "constructor", "prototype", "con", "prn", "aux", "nul" }, moduleId) >= 0 ||
                Regex.IsMatch(moduleId, "^(?:com|lpt)[1-9]$", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("Invalid job or module identity.");
            Guid run;
            if (!Guid.TryParse(job["runId"] as string, out run)) throw new InvalidOperationException("Run identity must be a UUID.");
            string runId = job["runId"] as string;
            string jobName = "Local\\claude-test-progress-" + run.ToString("D");
            string cwd = job["cwd"] as string, directory = job["directory"] as string;
            AssertAbsolute(cwd);
            AssertAbsolute(directory);
            AssertPrivatePath(directory);
            string expected = Path.Combine(directory, moduleId + "." + run.ToString("D") + ".job.json");
            if (!String.Equals(Path.GetFullPath(jobFile), Path.GetFullPath(expected), StringComparison.Ordinal))
                throw new InvalidOperationException("Job path does not match its identity.");
            string claimPath = Path.Combine(Path.Combine(directory, moduleId + ".lock"), "claim.json");
            AssertPrivatePath(claimPath);
            IDictionary claim = ReadPrivateJson(claimPath);
            if (!Is(claim["schemaVersion"], 1) || !String.Equals(claim["moduleId"] as string, moduleId, StringComparison.Ordinal) ||
                !String.Equals(claim["runId"] as string, runId, StringComparison.Ordinal))
                throw new InvalidOperationException("Run claim does not match job identity.");
            IDictionary command = job["windowsCommand"] as IDictionary;
            string file = command == null ? null : command["file"] as string;
            if (String.IsNullOrEmpty(file)) throw new InvalidOperationException("The private job is missing its validated windowsCommand.");
            AssertAbsolute(file);
            object[] rawArguments = command["args"] as object[];
            if (rawArguments == null) throw new InvalidOperationException("Command arguments must be an array.");
            string[] arguments = new string[rawArguments.Length];
            for (int index = 0; index < rawArguments.Length; index++) {
                arguments[index] = rawArguments[index] as string;
                if (arguments[index] == null) throw new InvalidOperationException("Command arguments must be strings.");
            }
            // The worker that started this broker supervises the run; the tree ends with it.
            IDictionary worker = claim["workerIdentity"] as IDictionary;
            object workerPid = worker == null ? null : worker["pid"];
            string cancelFile = Path.Combine(directory, moduleId + ".cancel.json");
            string sidecar = jobFile + ".windows.json";
            WindowsIdentity broker = WindowsProcessHost.Identity(WindowsProcessHostSelf());
            Dictionary<string, object> proof = new Dictionary<string, object>();
            proof["schema"] = 1; proof["runId"] = runId; proof["brokerIdentity"] = Identity(broker);
            proof["jobName"] = jobName; proof["contained"] = false; proof["resumed"] = false; proof["treeEmpty"] = false;
            proof["exitCode"] = null; proof["cancelled"] = false;
            WindowsProcessHost host = null;
            SupervisorWatch supervisor = null;
            int code = 125;
            try {
                supervisor = new SupervisorWatch(workerPid is int ? (int)workerPid : 0,
                    worker == null ? null : worker["startTime"] as string, worker == null ? null : worker["owner"] as string);
                // The only stdout/stderr writer is the native command; proof stays in the sidecar.
                host = new WindowsProcessHost(file, arguments, cwd, jobName);
                proof["contained"] = true;
                Dictionary<string, object> managed = Identity(broker);
                managed["jobName"] = jobName; managed["managedBroker"] = true; managed["contained"] = true;
                proof["brokerIdentity"] = managed;
                WriteAtomicJson(sidecar, proof);
                // No user command executes before both containment and its durable proof exist.
                bool cancelled = CancelRequested(cancelFile, moduleId, runId);
                if (cancelled) { proof["cancelled"] = true; host.Cancel(); }
                else {
                    host.Resume();
                    proof["resumed"] = true;
                    WriteAtomicJson(sidecar, proof);
                }
                // Waiting on the supervisor bounds both the idle CPU and the cancel latency.
                while (host.ActiveProcesses() != 0) {
                    if (!cancelled && supervisor.Exited(0)) {
                        cancelled = true; proof["cancelled"] = true; proof["supervisorLost"] = true; host.Cancel();
                    }
                    if (!cancelled && CancelRequested(cancelFile, moduleId, runId)) { cancelled = true; proof["cancelled"] = true; host.Cancel(); }
                    if (!cancelled) supervisor.Exited(250); else Thread.Sleep(25);
                }
                proof["treeEmpty"] = true;
                code = host.ExitCode();
                proof["exitCode"] = code;
                WriteAtomicJson(sidecar, proof);
            } catch (Exception error) {
                proof["error"] = error.Message;
                if (host != null && host.Contained) {
                    try {
                        host.Cancel();
                        DateTime deadline = DateTime.UtcNow.AddMilliseconds(1500);
                        while (host.ActiveProcesses() != 0 && DateTime.UtcNow < deadline) Thread.Sleep(25);
                        proof["treeEmpty"] = host.ActiveProcesses() == 0;
                    } catch { proof["treeEmpty"] = false; }
                }
                try { WriteAtomicJson(sidecar, proof); } catch { }
                Console.Error.WriteLine("Windows broker: " + error.Message);
            } finally {
                if (host != null) host.Dispose();
                if (supervisor != null) supervisor.Dispose();
            }
            return code;
        }
    }

    // Port of Select-TestProgressProjectNode in runtime/node-discovery.ps1: the same
    // candidates, order, probes and refusals, without starting PowerShell. No nvm
    // command, download, activation or PATH change is performed.
    public static class NodeDiscovery {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private const string Unavailable = "shims nvm 2.x não são executados nem baixam versões.";
        private sealed class Probe { public string path, version, lts; }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern IntPtr CreateFileW(string path, uint access, uint sharing, IntPtr attributes, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DeviceIoControl(IntPtr handle, uint code, IntPtr input, uint inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

        private static bool Absolute(string path) {
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) return false;
            // IsPathRooted alone accepts C:relative and \drive-relative.
            return Regex.IsMatch(path, "^[a-z]:[/\\\\]", RegexOptions.IgnoreCase) ||
                Regex.IsMatch(path, "^[/\\\\]{2}[^/\\\\]+[/\\\\][^/\\\\]+([/\\\\]|$)");
        }
        private static bool LocalPath(string path) {
            if (!Absolute(path) || Regex.IsMatch(path, "^[/\\\\]{2}") || Regex.IsMatch(path, "^[a-z]+://", RegexOptions.IgnoreCase)) return false;
            try { return new DriveInfo(Path.GetPathRoot(path)).DriveType != DriveType.Network; }
            catch { return false; }
        }
        // The target a junction or symbolic link names, read without following it; null for any
        // other reparse point, as PowerShell's Item.Target.
        private static string LinkTarget(string path) {
            IntPtr handle = CreateFileW(path, 0, 0x00000007, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero); // all sharing, OPEN_EXISTING, BACKUP_SEMANTICS | OPEN_REPARSE_POINT
            if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr buffer = Marshal.AllocHGlobal(16384);
            try {
                uint returned;
                if (!DeviceIoControl(handle, 0x000900A8, IntPtr.Zero, 0, buffer, 16384, out returned, IntPtr.Zero)) return null; // FSCTL_GET_REPARSE_POINT
                uint tag = unchecked((uint)Marshal.ReadInt32(buffer, 0));
                int names;
                if (tag == 0xA0000003) names = 16; // IO_REPARSE_TAG_MOUNT_POINT
                else if (tag == 0xA000000C) names = 20; // IO_REPARSE_TAG_SYMLINK, after its flags
                else return null;
                int substituteOffset = Marshal.ReadInt16(buffer, 8), substituteLength = Marshal.ReadInt16(buffer, 10);
                int printOffset = Marshal.ReadInt16(buffer, 12), printLength = Marshal.ReadInt16(buffer, 14);
                string print = Marshal.PtrToStringUni(IntPtr.Add(buffer, names + printOffset), printLength / 2);
                if (!String.IsNullOrEmpty(print)) return print;
                string substitute = Marshal.PtrToStringUni(IntPtr.Add(buffer, names + substituteOffset), substituteLength / 2);
                return substitute.StartsWith("\\??\\", StringComparison.Ordinal) ? substitute.Substring(4) : substitute;
            } finally { Marshal.FreeHGlobal(buffer); CloseHandle(handle); }
        }
        private static bool LocalTarget(string path) {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0) return true;
            string target = LinkTarget(path);
            if (target == null) return true;
            if (!Path.IsPathRooted(target)) target = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path)), target);
            return LocalPath(target);
        }
        private static bool LocalItem(string path) {
            if (!LocalPath(path)) return false;
            try { return (File.Exists(path) || Directory.Exists(path)) && LocalTarget(path); }
            catch { return false; }
        }
        private static string Cwd(string cwd) {
            if (!Absolute(cwd) || !Directory.Exists(cwd)) throw new ArgumentException("--cwd deve indicar um diretório absoluto existente.");
            return ProviderPath(cwd);
        }
        // As Resolve-Path reports it: separators, "." and ".." resolved, the spelling kept.
        // Path.GetFullPath on .NET Framework would also expand 8.3 names (RUNNER~1).
        private static string ProviderPath(string path) {
            string normalized = path.Replace('/', '\\');
            bool unc = normalized.StartsWith("\\\\", StringComparison.Ordinal);
            string[] parts = normalized.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
            int fixedParts = unc ? 2 : 1;
            List<string> kept = new List<string>();
            for (int index = 0; index < parts.Length; index++) {
                if (index >= fixedParts && parts[index] == ".") continue;
                if (index >= fixedParts && parts[index] == "..") { if (kept.Count > fixedParts) kept.RemoveAt(kept.Count - 1); continue; }
                kept.Add(parts[index]);
            }
            string result = (unc ? "\\\\" : "") + String.Join("\\", kept);
            return kept.Count == fixedParts && !unc ? result + "\\" : result;
        }

        private static List<string> Nvm2Roots() {
            // Read-only discovery, in the community CLI's policy/preferences precedence.
            string[][] keys = {
                new[] { "HKLM", "Software\\Policies\\Author Software\\nvm" }, new[] { "HKCU", "Software\\Policies\\Author Software\\nvm" },
                new[] { "HKLM", "Software\\Author Software\\Preferences\\nvm" }, new[] { "HKCU", "Software\\Author Software\\Preferences\\nvm" } };
            foreach (string[] key in keys) {
                try {
                    using (Microsoft.Win32.RegistryKey hive = key[0] == "HKLM" ? Microsoft.Win32.Registry.LocalMachine : Microsoft.Win32.Registry.CurrentUser)
                    using (Microsoft.Win32.RegistryKey item = hive.OpenSubKey(key[1])) {
                        string value = item == null ? null : item.GetValue("InstallRoot") as string;
                        if (value == null) continue;
                        string root = Environment.ExpandEnvironmentVariables(value);
                        if (LocalPath(root)) return new List<string> { root };
                    }
                } catch { }
            }
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (LocalPath(local)) {
                string root = Path.Combine(local, "Author Software\\nvm\\installs");
                if (LocalPath(root)) return new List<string> { root };
            }
            return new List<string>();
        }
        // Inspects file metadata without executing a nvm 2.x shim, which may auto-install.
        private static bool Shim(string candidate) {
            try {
                FileVersionInfo metadata = FileVersionInfo.GetVersionInfo(candidate);
                if (String.Equals(metadata.ProductName, "NVM for Windows", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(metadata.FileDescription, "Node.js shim", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(metadata.OriginalFilename, "shim.exe", StringComparison.OrdinalIgnoreCase)) return true;
            } catch { }
            foreach (string root in Nvm2Roots()) {
                string parent = Path.GetDirectoryName(root);
                foreach (string directory in new[] { ".shim", ".nodejs" }) {
                    string shim = Path.Combine(Path.Combine(parent, directory), "node.exe");
                    if (String.Equals(Path.GetFullPath(candidate), Path.GetFullPath(shim), StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            return false;
        }
        private static Probe NodeProbe(string candidate, string cwd) {
            try {
                if (!Path.IsPathRooted(candidate) || Shim(candidate)) return null;
                const string code = "process.stdout.write(JSON.stringify({path:process.execPath,version:process.version,lts:(process.release && process.release.lts) || null}))";
                ProcessStartInfo info = new ProcessStartInfo(candidate, "-e " + WindowsProcessHost.QuoteArgument(code));
                info.WorkingDirectory = cwd; info.UseShellExecute = false; info.CreateNoWindow = true;
                info.RedirectStandardOutput = true; info.RedirectStandardError = true;
                info.StandardOutputEncoding = new UTF8Encoding(false); info.StandardErrorEncoding = new UTF8Encoding(false);
                using (Process process = new Process()) {
                    process.StartInfo = info;
                    Stopwatch deadline = Stopwatch.StartNew();
                    if (!process.Start()) return null;
                    // Drain both pipes while waiting so a broken executable cannot fill one.
                    System.Threading.Tasks.Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                    System.Threading.Tasks.Task<string> stderr = process.StandardError.ReadToEndAsync();
                    if (!process.WaitForExit(Math.Max(0, 2000 - (int)deadline.ElapsedMilliseconds))) {
                        try { process.Kill(); } catch { }
                        return null;
                    }
                    if (process.ExitCode != 0) return null;
                    if (!stdout.Wait(Math.Max(0, 2000 - (int)deadline.ElapsedMilliseconds))) return null;
                    if (!stderr.Wait(Math.Max(0, 2000 - (int)deadline.ElapsedMilliseconds))) return null;
                    IDictionary value = Json.DeserializeObject(stdout.Result) as IDictionary;
                    string path = value == null ? null : value["path"] as string, version = value == null ? null : value["version"] as string;
                    if (path == null || !Absolute(path) || !File.Exists(path) || version == null ||
                        !Regex.IsMatch(version, "^v[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$", RegexOptions.IgnoreCase)) return null;
                    string lts = value.Contains("lts") ? value["lts"] as string : null;
                    return new Probe { path = path, version = version, lts = String.IsNullOrWhiteSpace(lts) ? null : lts };
                }
            } catch { return null; }
        }
        private static IEnumerable<string> PathCandidates(string cwd) {
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
                string candidate = null;
                try {
                    string directory = entry.Trim('"');
                    if (String.IsNullOrWhiteSpace(directory)) directory = cwd;
                    if (!Path.IsPathRooted(directory)) directory = Path.Combine(cwd, directory);
                    candidate = Path.Combine(directory, "node.exe");
                    if (seen.Contains(candidate) || !File.Exists(candidate)) candidate = null;
                } catch { candidate = null; }
                if (candidate == null) continue;
                seen.Add(candidate);
                yield return candidate;
            }
        }
        private static IEnumerable<string> NvmCurrentCandidate() {
            string link = Environment.GetEnvironmentVariable("NVM_SYMLINK");
            if (!LocalPath(link) || !Directory.Exists(link)) yield break;
            bool local;
            // Check a junction or symlink target too; never follow a network target.
            try { local = LocalTarget(link); } catch { local = false; }
            if (!local) yield break;
            string candidate = Path.Combine(Path.GetFullPath(link), "node.exe");
            if (LocalItem(candidate) && File.Exists(candidate)) yield return candidate;
        }
        private static List<string> NvmCandidates() {
            List<string> roots = Nvm2Roots();
            string home = Environment.GetEnvironmentVariable("NVM_HOME");
            if (LocalItem(home)) {
                roots.Add(home);
                string settings = Path.Combine(home, "settings.txt");
                if (LocalItem(settings) && File.Exists(settings)) {
                    foreach (string line in File.ReadAllLines(settings)) {
                        Match match = Regex.Match(line, "^\\s*root\\s*:\\s*(.*?)\\s*$", RegexOptions.IgnoreCase);
                        if (!match.Success) continue;
                        string root = Environment.ExpandEnvironmentVariables(match.Groups[1].Value.Trim('"'));
                        if (LocalItem(root)) roots.Add(root);
                    }
                }
            }
            List<string> result = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // Current first; the aliases node/stable/LTS then order actual probed versions.
            foreach (string candidate in NvmCurrentCandidate()) { seen.Add(candidate); result.Add(candidate); }
            List<KeyValuePair<Version, string>> installed = new List<KeyValuePair<Version, string>>();
            HashSet<string> visited = new HashSet<string>(StringComparer.Ordinal);
            foreach (string root in roots) {
                if (!visited.Add(root) || !LocalItem(root) || !Directory.Exists(root)) continue;
                foreach (DirectoryInfo directory in new DirectoryInfo(root).GetDirectories()) {
                    // Get-ChildItem without -Force leaves hidden and system entries out.
                    if ((directory.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                    Match match = Regex.Match(directory.Name, "^v?([0-9]+\\.[0-9]+\\.[0-9]+)$", RegexOptions.IgnoreCase);
                    if (!match.Success || !LocalItem(directory.FullName)) continue;
                    string candidate = Path.Combine(directory.FullName, "node.exe");
                    if (LocalItem(candidate) && File.Exists(candidate))
                        installed.Add(new KeyValuePair<Version, string>(new Version(match.Groups[1].Value), candidate));
                }
            }
            installed.Sort((left, right) => right.Key.CompareTo(left.Key));
            foreach (KeyValuePair<Version, string> entry in installed)
                if (seen.Add(entry.Value)) result.Add(entry.Value);
            return result;
        }
        private static bool VersionMatches(Probe probe, string selector) {
            if (probe == null) return false;
            string version = probe.version.Substring(1);
            string numeric = Regex.Replace(selector, "^v", "", RegexOptions.IgnoreCase);
            return version == numeric || version.StartsWith(numeric + ".", StringComparison.Ordinal);
        }
        private static Dictionary<string, object> Descriptor(Probe probe, string source, string nvmrc) {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["path"] = probe.path; result["version"] = probe.version; result["source"] = source; result["nvmrc"] = nvmrc;
            return result;
        }
        private static string Nvmrc(string cwd) {
            for (string directory = cwd; directory != null; ) {
                string file = Path.Combine(directory, ".nvmrc");
                if (File.Exists(file) || Directory.Exists(file)) return file;
                DirectoryInfo parent = Directory.GetParent(directory);
                directory = parent == null ? null : parent.FullName;
            }
            return null;
        }
        private static string NvmrcSelector(string file) {
            if (!File.Exists(file)) throw new InvalidOperationException(".nvmrc deve ser um arquivo legível.");
            string selector = null;
            foreach (string line in File.ReadAllLines(file)) {
                string value = line.Split(new[] { '#' }, 2)[0].Trim();
                if (value.Length == 0 || value.Contains("=")) continue;
                if (selector != null || Regex.IsMatch(value, "\\s") || value.StartsWith("-", StringComparison.Ordinal))
                    throw new InvalidOperationException(".nvmrc deve conter exatamente um seletor de versão, sem opções.");
                selector = value;
            }
            if (selector == null) throw new InvalidOperationException(".nvmrc não contém um seletor de versão.");
            return selector;
        }
        public static Dictionary<string, object> SelectProject(string cwd) {
            string directory = Cwd(cwd);
            string nvmrc = Nvmrc(directory);
            if (nvmrc == null) {
                foreach (string candidate in PathCandidates(directory)) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (probe != null) return Descriptor(probe, "path", null);
                }
                foreach (string candidate in NvmCandidates()) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (probe != null) return Descriptor(probe, "nvm", null);
                }
                throw new InvalidOperationException("Node do projeto não encontrado no PATH ou nas instalações locais do nvm-windows; " + Unavailable);
            }
            string selector = NvmrcSelector(nvmrc);
            string lower = selector.ToLowerInvariant();
            if (Regex.IsMatch(selector, "^v?[0-9]+(\\.[0-9]+){0,2}$")) {
                foreach (string candidate in PathCandidates(directory)) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (VersionMatches(probe, selector)) return Descriptor(probe, "nvmrc-path", nvmrc);
                }
                foreach (string candidate in NvmCandidates()) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (VersionMatches(probe, selector)) return Descriptor(probe, "nvmrc-nvm", nvmrc);
                }
            } else if (lower == "current" || lower == "default") {
                // nvm-windows has no separate persistent default alias: both use NVM_SYMLINK.
                foreach (string candidate in NvmCurrentCandidate()) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (probe != null) return Descriptor(probe, "nvmrc-nvm", nvmrc);
                }
            } else if (lower == "node" || lower == "stable" || Regex.IsMatch(selector, "^lts/(\\*|[a-z0-9-]+)$", RegexOptions.IgnoreCase)) {
                Probe latest = null;
                Version order = null;
                foreach (string candidate in NvmCandidates()) {
                    Probe probe = NodeProbe(candidate, directory);
                    if (probe == null || !Regex.IsMatch(probe.version, "^v[0-9]+\\.[0-9]+\\.[0-9]+$", RegexOptions.IgnoreCase)) continue;
                    if (lower.StartsWith("lts/", StringComparison.Ordinal)) {
                        string codename = selector.Substring(4);
                        if (probe.lts == null || (codename != "*" && !String.Equals(probe.lts, codename, StringComparison.OrdinalIgnoreCase))) continue;
                    }
                    Version version = new Version(probe.version.Substring(1));
                    if (order == null || version > order) { latest = probe; order = version; }
                }
                if (latest != null) return Descriptor(latest, "nvmrc-nvm", nvmrc);
            } else {
                throw new InvalidOperationException("Alias .nvmrc não suportado no nvm-windows local: " + selector +
                    ". Use versão numérica, current, default, node, stable ou lts/<nome|*>.");
            }
            throw new InvalidOperationException("A versão exigida pela .nvmrc (" + selector + ") não está disponível localmente; nenhum fallback foi aplicado.");
        }
    }
}
