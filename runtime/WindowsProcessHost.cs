// C# 5 / .NET Framework-compatible: loaded by Windows PowerShell 5.1 and 7.
using System;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace TestProgress {
    public sealed class WindowsIdentity {
        public string platform = "win32";
        public int pid;
        public string startTime;
        public string owner;
        public int sessionId;
    }

    // A handle to the broker's supervising worker, opened once and authenticated by
    // start time and owner: the PID cannot be reused while it is open, so its signal
    // is the kernel's answer that the supervisor ended.
    public sealed class SupervisorWatch : IDisposable {
        private IntPtr handle;
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
        public SupervisorWatch(int pid, string startTime, string owner) {
            if (pid <= 0 || String.IsNullOrEmpty(startTime) || String.IsNullOrEmpty(owner))
                throw new ArgumentException("The run claim has no supervising worker identity.");
            handle = OpenProcess(0x00100000 | 0x1000, false, pid); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                WindowsIdentity current = WindowsProcessHost.Identity(pid);
                if (current == null || current.startTime != startTime || current.owner != owner)
                    throw new InvalidOperationException("The supervising worker identity does not match the run claim.");
            } catch { Dispose(); throw; }
        }
        // Waits up to timeout milliseconds; true once the supervisor has exited.
        public bool Exited(uint timeout) {
            uint observed = WaitForSingleObject(handle, timeout);
            if (observed == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            return observed == 0;
        }
        public void Dispose() {
            if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
        }
    }

    public sealed class WindowsProcessHost : IDisposable {
        private IntPtr job;
        private IntPtr process;
        private IntPtr thread;
        private bool assigned;
        private bool resumed;
        public bool Contained { get { return assigned; } }
        public string JobName { get; private set; }

        [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; }
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimit {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimit {
            public BasicLimit Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)] private struct Accounting {
            public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
            public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo {
            public uint Size;
            public string Reserved, Desktop, Title;
            public uint X, Y, Width, Height, XChars, YChars, FillAttribute, Flags;
            public ushort ShowWindow, ReservedBytes;
            public IntPtr ReservedPointer, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx {
            public StartupInfo Startup;
            public IntPtr Attributes;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation {
            public IntPtr Process, Thread;
            public uint ProcessId, ThreadId;
        }
        [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {
            public uint Size;
            public IntPtr Descriptor;
            public int InheritHandle;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern bool CreateDirectoryW(string path, ref SecurityAttributes attributes);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern IntPtr CreateFileW(string path, uint access, uint sharing, ref SecurityAttributes attributes, uint disposition, uint flags, IntPtr template);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string descriptor, uint revision, out IntPtr security, out uint size);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
        [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ProcessIdToSessionId(uint pid, out uint sessionId);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr handle, int kind, ref ExtendedLimit info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr handle, int kind, out Accounting info, uint length, IntPtr returnedLength);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern bool CreateProcessW(string file, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInformation info);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref UIntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributes);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int which);
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inheritable, uint options);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr handle, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr handle, uint code);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr info, int size, out int required);

        private static void Check(bool success) {
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public static void CreatePrivateDirectory(string path, string owner) {
            // The owner and protected DACL are present at creation, including
            // elevated tokens whose default owner is the Administrators group.
            string sid = new SecurityIdentifier(owner).Value;
            IntPtr security;
            uint size;
            Check(ConvertStringSecurityDescriptorToSecurityDescriptorW(
                "O:" + sid + "D:P(A;OICI;FA;;;" + sid + ")(A;OICI;FA;;;SY)", 1, out security, out size));
            try {
                SecurityAttributes attributes = new SecurityAttributes {
                    Size = (uint)Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = security, InheritHandle = 0
                };
                if (!CreateDirectoryW(path, ref attributes)) {
                    int error = Marshal.GetLastWin32Error();
                    // Existing paths are authenticated by the caller, never
                    // adopted or assigned a new owner by this creation step.
                    if (error != 183) throw new Win32Exception(error);
                }
            } finally { LocalFree(security); }
        }
        private static WindowsIdentity IdentityForHandle(IntPtr handle, int pid) {
            FileTime creation, exit, kernel, user;
            Check(GetProcessTimes(handle, out creation, out exit, out kernel, out user));
            IntPtr token;
            Check(OpenProcessToken(handle, 0x0008, out token)); // TOKEN_QUERY
            try {
                int required;
                GetTokenInformation(token, 1, IntPtr.Zero, 0, out required); // TokenUser
                if (required <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr buffer = Marshal.AllocHGlobal(required);
                try {
                    Check(GetTokenInformation(token, 1, buffer, required, out required));
                    string owner = new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
                    uint sessionId;
                    Check(ProcessIdToSessionId((uint)pid, out sessionId));
                    return new WindowsIdentity { pid = pid, owner = owner, sessionId = checked((int)sessionId),
                        startTime = (((ulong)creation.High << 32) | creation.Low).ToString(CultureInfo.InvariantCulture) };
                } finally { Marshal.FreeHGlobal(buffer); }
            } finally { CloseHandle(token); }
        }
        public static WindowsIdentity Identity(int pid) {
            if (pid <= 0) return null;
            IntPtr handle = OpenProcess(0x00100000 | 0x1000, false, pid); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
            if (handle == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                if (error == 87) return null; // PID does not exist
                throw new Win32Exception(error);
            }
            try {
                if (WaitForSingleObject(handle, 0) == 0) return null;
                return IdentityForHandle(handle, pid);
            } finally { CloseHandle(handle); }
        }
        public static string State(int pid, string startTime, string owner) {
            try {
                WindowsIdentity current = Identity(pid);
                return current == null || current.startTime != startTime || current.owner != owner ? "empty" : "present";
            } catch { return "unknown"; }
        }
        private static bool ValidJobName(string jobName) {
            return jobName != null && System.Text.RegularExpressions.Regex.IsMatch(jobName,
                "^Local\\\\claude-test-progress-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        }
        public static string Group(string jobName, int sessionId) {
            if (!ValidJobName(jobName)) return "unknown";
            try {
                uint currentSession;
                Check(ProcessIdToSessionId(GetCurrentProcessId(), out currentSession));
                // Local names belong to a Windows login session; absence in a
                // different session is not evidence that the original job ended.
                if (sessionId < 0 || currentSession != (uint)sessionId) return "unknown";
                IntPtr handle = OpenJobObject(0x0004, false, jobName); // JOB_OBJECT_QUERY
                if (handle == IntPtr.Zero)
                    return Marshal.GetLastWin32Error() == 2 ? "empty" : "unknown";
                try {
                    Accounting info;
                    Check(QueryInformationJobObject(handle, 1, out info,
                        (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
                    return info.ActiveProcesses == 0 ? "empty" : "present";
                } finally {
                    // If this was the last handle, KILL_ON_JOB_CLOSE may start
                    // termination now. A positive count above still returns
                    // present; a later query must prove empty or destruction.
                    CloseHandle(handle);
                }
            } catch { return "unknown"; }
        }
        public static void KillOwned(int pid, string startTime, string owner) {
            // Open once, verify and terminate THAT handle; PID reuse cannot change the target.
            IntPtr handle = OpenProcess(0x00100000 | 0x1000 | 0x0001, false, pid);
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                WindowsIdentity current = IdentityForHandle(handle, pid);
                WindowsIdentity self = IdentityForHandle(GetCurrentProcess(), (int)GetCurrentProcessId());
                if (current.startTime != startTime || current.owner != owner || owner != self.owner)
                    throw new InvalidOperationException("Broker identity or owner does not match; no process was terminated.");
                if (WaitForSingleObject(handle, 0) != 0) Check(TerminateProcess(handle, 130));
                if (WaitForSingleObject(handle, 1500) != 0)
                    throw new InvalidOperationException("Broker termination has not completed.");
            } finally { CloseHandle(handle); }
        }

        public static string QuoteArgument(string value) {
            if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid command argument.");
            StringBuilder result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
                else { result.Append('\\', slashes); result.Append(c); }
                slashes = 0;
            }
            result.Append('\\', slashes * 2); result.Append('"');
            return result.ToString();
        }
        private static IntPtr InheritStandardHandle(int which) {
            IntPtr duplicate;
            Check(DuplicateHandle(GetCurrentProcess(), GetStdHandle(which), GetCurrentProcess(), out duplicate, 0, true, 2));
            return duplicate;
        }

        private static IntPtr InheritNullHandle(uint access) {
            SecurityAttributes attributes = new SecurityAttributes {
                Size = (uint)Marshal.SizeOf(typeof(SecurityAttributes)), InheritHandle = 1
            };
            IntPtr handle = CreateFileW("NUL", access, 0x00000001 | 0x00000002,
                ref attributes, 3, 0x00000080, IntPtr.Zero); // SHARE_READ | SHARE_WRITE, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL
            if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return handle;
        }

        public static WindowsIdentity StartDetached(string file, string[] args, string cwd) {
            if (String.IsNullOrEmpty(file) || !System.IO.Path.IsPathRooted(file))
                throw new ArgumentException("Executable must be an absolute path.");
            if (args == null) throw new ArgumentNullException("args");
            StringBuilder command = new StringBuilder(QuoteArgument(file));
            foreach (string argument in args) { command.Append(' '); command.Append(QuoteArgument(argument)); }
            IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero;
            IntPtr input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
            bool initialized = false, created = false;
            ProcessInformation info = new ProcessInformation();
            try {
                // The coordinator must not retain ancestor pipes, even if the
                // Node/PowerShell caller inherited other handles from its parent.
                input = InheritNullHandle(0x80000000); // GENERIC_READ
                output = InheritNullHandle(0x40000000); // GENERIC_WRITE
                error = InheritNullHandle(0x40000000);
                UIntPtr size = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                attributes = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
                Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
                initialized = true;
                handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
                Marshal.WriteIntPtr(handles, 0, input);
                Marshal.WriteIntPtr(handles, IntPtr.Size, output);
                Marshal.WriteIntPtr(handles, 2 * IntPtr.Size, error);
                Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x00020002), handles,
                    new UIntPtr((uint)(3 * IntPtr.Size)), IntPtr.Zero, IntPtr.Zero)); // HANDLE_LIST only; no containment JOB_LIST
                StartupInfoEx startup = new StartupInfoEx();
                startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
                startup.Startup.Flags = 0x00000100; // STARTF_USESTDHANDLES
                startup.Startup.Input = input; startup.Startup.Output = output; startup.Startup.Error = error;
                startup.Attributes = attributes;
                Check(CreateProcessW(file, command, IntPtr.Zero, IntPtr.Zero, true,
                    0x00000004 | 0x00080000 | 0x08000000, IntPtr.Zero, cwd, ref startup, out info)); // SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW
                created = true;
                // Capture durable identity before user code can run or exit.
                WindowsIdentity identity = IdentityForHandle(info.Process, checked((int)info.ProcessId));
                if (ResumeThread(info.Thread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
                return identity;
            } catch (Exception failure) {
                // This is the handle returned by this creation, never a reopened
                // PID; failed identity capture/resume cannot target a reused PID.
                if (created && !TerminateProcess(info.Process, 125))
                    throw new InvalidOperationException("Detached coordinator cleanup failed.",
                        new AggregateException(failure, new Win32Exception(Marshal.GetLastWin32Error())));
                throw;
            } finally {
                if (created && info.Thread != IntPtr.Zero) CloseHandle(info.Thread);
                if (created && info.Process != IntPtr.Zero) CloseHandle(info.Process);
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
                if (input != IntPtr.Zero) CloseHandle(input);
                if (output != IntPtr.Zero) CloseHandle(output);
                if (error != IntPtr.Zero) CloseHandle(error);
            }
        }

        public WindowsProcessHost(string file, string[] arguments, string cwd, string jobName) {
            if (String.IsNullOrEmpty(file) || !System.IO.Path.IsPathRooted(file))
                throw new ArgumentException("Executable must be an absolute path.");
            if (!ValidJobName(jobName)) throw new ArgumentException("Invalid containment job name.");
            IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobList = IntPtr.Zero;
            bool initialized = false;
            IntPtr input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
            try {
                // Named per random run UUID; non-inheritable, with the creator's
                // default DACL. Never reuse a pre-existing object or change it.
                SetLastError(0);
                job = CreateJobObject(IntPtr.Zero, jobName);
                int creationError = Marshal.GetLastWin32Error();
                if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (creationError == 183) { // ERROR_ALREADY_EXISTS
                    CloseHandle(job); job = IntPtr.Zero;
                    throw new InvalidOperationException("Containment job name already exists.");
                }
                JobName = jobName;
                ExtendedLimit limits = new ExtendedLimit();
                limits.Basic.Flags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no BREAKAWAY flags
                Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
                input = InheritStandardHandle(-10);
                output = InheritStandardHandle(-11);
                error = InheritStandardHandle(-12);
                UIntPtr size = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                attributes = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
                Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size));
                initialized = true;
                handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
                Marshal.WriteIntPtr(handles, 0, input);
                Marshal.WriteIntPtr(handles, IntPtr.Size, output);
                Marshal.WriteIntPtr(handles, 2 * IntPtr.Size, error);
                Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x00020002), handles,
                    new UIntPtr((uint)(3 * IntPtr.Size)), IntPtr.Zero, IntPtr.Zero)); // HANDLE_LIST
                // Windows 10+: assign atomically during creation. A broker crash
                // between CreateProcess and a later AssignProcessToJobObject would
                // otherwise leave a suspended process outside KILL_ON_JOB_CLOSE.
                jobList = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobList, job);
                Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x0002000D), jobList,
                    new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero)); // JOB_LIST
                StartupInfoEx startup = new StartupInfoEx();
                startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
                startup.Startup.Flags = 0x00000100; // STARTF_USESTDHANDLES
                startup.Startup.Input = input; startup.Startup.Output = output; startup.Startup.Error = error;
                startup.Attributes = attributes;
                StringBuilder command = new StringBuilder(QuoteArgument(file));
                bool cmd = String.Equals(System.IO.Path.GetFileName(file), "cmd.exe", StringComparison.OrdinalIgnoreCase);
                if (cmd && (arguments.Length != 5 || arguments[0] != "/d" || arguments[1] != "/s" ||
                    arguments[2] != "/v:off" || arguments[3] != "/c" ||
                    String.IsNullOrEmpty(arguments[4]) ||
                    System.Text.RegularExpressions.Regex.IsMatch(arguments[4], "[&|<>^()%!\\r\\n\\x00]")))
                    throw new ArgumentException("cmd.exe requires a validated, literal command without shell expansion or control.");
                for (int index = 0; index < arguments.Length; index++) {
                    command.Append(' ');
                    // cmd.exe /c must receive the strict, already-quoted command string verbatim.
                    command.Append(cmd ? arguments[index] : QuoteArgument(arguments[index]));
                }
                ProcessInformation info;
                Check(CreateProcessW(file, command, IntPtr.Zero, IntPtr.Zero, true,
                    0x00000004 | 0x00080000, IntPtr.Zero, cwd, ref startup, out info)); // SUSPENDED | EXTENDED_STARTUPINFO_PRESENT
                process = info.Process; thread = info.Thread;
                bool inJob;
                Check(IsProcessInJob(process, job, out inJob));
                if (!inJob) throw new InvalidOperationException("Process creation did not attach the containment job.");
                assigned = true;
            } catch { Dispose(); throw; }
            finally {
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (input != IntPtr.Zero) CloseHandle(input);
                if (output != IntPtr.Zero) CloseHandle(output);
                if (error != IntPtr.Zero) CloseHandle(error);
            }
        }
        public void Resume() {
            if (!assigned || resumed) throw new InvalidOperationException("Process is not suspended in its job.");
            if (ResumeThread(thread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            resumed = true;
            CloseHandle(thread); thread = IntPtr.Zero;
        }
        public uint ActiveProcesses() {
            Accounting info;
            Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
            return info.ActiveProcesses;
        }
        public int ExitCode() {
            if (ActiveProcesses() != 0)
                throw new InvalidOperationException("Process tree has not exited.");
            // The job's active count may reach zero just before the retained
            // leader handle is signalled. Observe kernel exit with a bounded wait.
            uint observed = WaitForSingleObject(process, 1500);
            if (observed == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (observed != 0 || ActiveProcesses() != 0)
                throw new InvalidOperationException("Process tree exit was not confirmed.");
            uint code;
            Check(GetExitCodeProcess(process, out code));
            return unchecked((int)code);
        }
        public void Cancel() { Check(TerminateJobObject(job, 130)); }
        public void Dispose() {
            // Assignment failures must also kill the still-suspended, unmanaged process.
            if (process != IntPtr.Zero && !assigned) TerminateProcess(process, 125);
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            if (thread != IntPtr.Zero) { CloseHandle(thread); thread = IntPtr.Zero; }
            if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
        }
    }
}
