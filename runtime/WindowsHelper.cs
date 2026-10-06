// C# 5 / .NET Framework: native control helper compiled once by Windows PowerShell 5.1.
// Same actions, validation and JSON as runtime/windows-process.ps1, without starting
// PowerShell on every call. Any failure to build or run it falls back to that script.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
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
            "Directory", "Child", "Collector", "Runner", "Queries", "SelfProcessId" };
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
            Write(Identity(WindowsProcessHost.StartDetached(collector, new string[] { coordinator, jobFile }, runner)));
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
            string cancelFile = Path.Combine(directory, moduleId + ".cancel.json");
            string sidecar = jobFile + ".windows.json";
            WindowsIdentity broker = WindowsProcessHost.Identity(WindowsProcessHostSelf());
            Dictionary<string, object> proof = new Dictionary<string, object>();
            proof["schema"] = 1; proof["runId"] = runId; proof["brokerIdentity"] = Identity(broker);
            proof["jobName"] = jobName; proof["contained"] = false; proof["resumed"] = false; proof["treeEmpty"] = false;
            proof["exitCode"] = null; proof["cancelled"] = false;
            WindowsProcessHost host = null;
            int code = 125;
            try {
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
                while (host.ActiveProcesses() != 0) {
                    if (!cancelled && CancelRequested(cancelFile, moduleId, runId)) { cancelled = true; proof["cancelled"] = true; host.Cancel(); }
                    Thread.Sleep(100);
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
            }
            return code;
        }
    }
}
