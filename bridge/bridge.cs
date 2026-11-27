using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Threading;

class Mach3Bridge
{
    const string PORT = "8765";

    class LineMachState
    {
        public int ActiveDispenserId;
        public bool ValveOpen;
        public int[] LoweredDispensers;
    }

    static dynamic mach = null;
    static dynamic scripter = null;
    static bool isMachConnected = false;
    static readonly object lockObj = new object();

    static bool valveOpen = false;
    static List<int> loweredDispensers = new List<int>();
    static int activeDispenserId = 1;
    static int totalLines = 0;
    static string loadedGcodeHash = "";
    static string loadedFileName = "";
    static int gcodeFileSlot = 0;
    static string valveOpenCmd = "M11 P3";
    static string valveCloseCmd = "M10 P3";
    static int defaultFeed = 3000;
    static Dictionary<int, string> dispenserLowerCmds = new Dictionary<int, string>();
    static Dictionary<int, string> dispenserRaiseCmds = new Dictionary<int, string>();
    static readonly string bridgeToken = CreateBridgeToken();

    static List<LineMachState> loadedLineStates = new List<LineMachState>();
    static bool activeFileJobRunning = false;
    static DateTime fileJobGraceUntilUtc = DateTime.MinValue;

    static string CreateBridgeToken()
    {
        byte[] bytes = new byte[32];
        using (var rng = new System.Security.Cryptography.RNGCryptoServiceProvider())
        {
            rng.GetBytes(bytes);
        }
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    static void InitDefaultCmds()
    {
        valveOpenCmd = "M11 P3";
        valveCloseCmd = "M10 P3";
        defaultFeed = 3000;
        for (int i = 1; i <= 5; i++)
        {
            dispenserLowerCmds[i] = "M11 P" + (3 + i);
            dispenserRaiseCmds[i] = "M10 P" + (3 + i);
        }
    }

    static bool IsPureAsciiPath(string path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        for (int i = 0; i < path.Length; i++)
        {
            char c = path[i];
            if (c < 32 || c > 126) return false;
        }
        return true;
    }

    static string GetSafeTempDir()
    {
        try
        {
            string localTemp = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "temp");
            if (IsPureAsciiPath(localTemp))
            {
                if (!Directory.Exists(localTemp)) Directory.CreateDirectory(localTemp);
                return localTemp;
            }
        }
        catch { }

        try
        {
            if (Directory.Exists(@"C:\Mach3"))
            {
                string machTemp = @"C:\Mach3\GCode\cnc_temp";
                if (!Directory.Exists(machTemp)) Directory.CreateDirectory(machTemp);
                return machTemp;
            }
        }
        catch { }

        return Path.GetTempPath();
    }

    static string GetAutosaveFilePath()
    {
        try
        {
            string localTemp = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "temp");
            if (!Directory.Exists(localTemp)) Directory.CreateDirectory(localTemp);
            return Path.Combine(localTemp, "tabs_autosave.json");
        }
        catch
        {
            return Path.Combine(Path.GetTempPath(), "cnc_tabs_autosave.json");
        }
    }

    static bool IsTrustedOrigin(string origin)
    {
        if (string.IsNullOrEmpty(origin)) return true;
        return string.Equals(origin, "http://127.0.0.1:8765", StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, "http://localhost:8765", StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, "null", StringComparison.OrdinalIgnoreCase);
    }

    static bool IsAuthorizedBridgeRequest(HttpListenerRequest req)
    {
        string origin = req.Headers["Origin"];
        if (!IsTrustedOrigin(origin)) return false;
        string supplied = req.Headers["X-Bridge-Token"];
        return !string.IsNullOrEmpty(supplied)
            && string.Equals(supplied, bridgeToken, StringComparison.Ordinal);
    }

    static bool EnsureMach3()
    {
        lock (lockObj)
        {
            if (Process.GetProcessesByName("Mach3").Length == 0)
            {
                if (isMachConnected)
                {
                    LogWarning("[MACH3] Mach3 e isklucen.");
                    isMachConnected = false;
                    mach = null;
                    scripter = null;
                    loadedGcodeHash = "";
                    loadedFileName = "";
                    loadedLineStates.Clear();
                    activeFileJobRunning = false;
                }
                return false;
            }

            if (isMachConnected && scripter != null)
            {
                try
                {
                    double pingX = Convert.ToDouble(scripter.GetDRO(0));
                    return true;
                }
                catch
                {
                    LogWarning("[MACH3] COM vrskata bese prekinata, obid za povtorno povrzuvanje...");
                    isMachConnected = false;
                    mach = null;
                    scripter = null;
                }
            }

            try
            {
                object activeObj = Marshal.GetActiveObject("Mach4.Document");
                mach = activeObj;
                scripter = mach.GetScriptDispatch();

                double x = Convert.ToDouble(scripter.GetDRO(0));

                isMachConnected = true;
                LogSuccess("[MACH3] USPESNO POVRZAN SO MACH3 (" + string.Format(CultureInfo.InvariantCulture, "X={0:F3}", x) + ")!");
                return true;
            }
            catch
            {
                isMachConnected = false;
                mach = null;
                scripter = null;
                return false;
            }
        }
    }

    static string UnescapeJsonString(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        StringBuilder sb = new StringBuilder(raw.Length);
        for (int i = 0; i < raw.Length; i++)
        {
            char c = raw[i];
            if (c == '\\' && i + 1 < raw.Length)
            {
                char next = raw[i + 1];
                if (next == 'n') { sb.Append('\n'); i++; }
                else if (next == 'r') { sb.Append('\r'); i++; }
                else if (next == 't') { sb.Append('\t'); i++; }
                else if (next == 'b') { sb.Append('\b'); i++; }
                else if (next == 'f') { sb.Append('\f'); i++; }
                else if (next == '"') { sb.Append('"'); i++; }
                else if (next == '\\') { sb.Append('\\'); i++; }
                else if (next == '/') { sb.Append('/'); i++; }
                else if (next == 'u' && i + 5 < raw.Length)
                {
                    string hex = raw.Substring(i + 2, 4);
                    int code;
                    if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                    {
                        sb.Append((char)code);
                        i += 5;
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                else
                {
                    sb.Append(next);
                    i++;
                }
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }

    static string ExtractJsonString(string json, string key)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return null;
        Match mKey = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"");
        if (!mKey.Success) return null;

        int pos = mKey.Index + mKey.Length;
        StringBuilder raw = new StringBuilder();
        while (pos < json.Length)
        {
            char c = json[pos];
            if (c == '\\' && pos + 1 < json.Length)
            {
                raw.Append(c);
                raw.Append(json[pos + 1]);
                pos += 2;
                continue;
            }
            if (c == '"') break;
            raw.Append(c);
            pos++;
        }
        return UnescapeJsonString(raw.ToString());
    }

    static double ExtractJsonDouble(string json, string key, double fallback)
    {
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return fallback;
        Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*([-0-9.]+)");
        if (!m.Success) return fallback;
        double val;
        if (double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out val))
        {
            return val;
        }
        return fallback;
    }

    static void ApplyConfigFromBody(string body)
    {
        if (string.IsNullOrEmpty(body)) return;

        string vOpen = ExtractJsonString(body, "valveOpenCmd");
        if (!string.IsNullOrEmpty(vOpen)) valveOpenCmd = vOpen.ToUpper().Trim();

        string vClose = ExtractJsonString(body, "valveCloseCmd");
        if (!string.IsNullOrEmpty(vClose)) valveCloseCmd = vClose.ToUpper().Trim();

        double fVal = ExtractJsonDouble(body, "feed", 0);
        if (fVal > 0) defaultFeed = Math.Max(1, (int)Math.Round(fVal));

        Match mArr = Regex.Match(body, "\"dispensers\"\\s*:\\s*\\[([\\s\\S]*?)\\]");
        if (mArr.Success)
        {
            string arrContent = mArr.Groups[1].Value;
            MatchCollection objs = Regex.Matches(arrContent, "\\{([^}]+)\\}");
            if (objs.Count > 0)
            {
                Dictionary<int, string> nextLower = new Dictionary<int, string>();
                Dictionary<int, string> nextRaise = new Dictionary<int, string>();
                foreach (Match objMatch in objs)
                {
                    string objJson = objMatch.Groups[1].Value;
                    Match mId = Regex.Match(objJson, "\"id\"\\s*:\\s*(\\d+)");
                    if (!mId.Success) continue;
                    int dId = int.Parse(mId.Groups[1].Value, CultureInfo.InvariantCulture);

                    string lCmd = ExtractJsonString(objJson, "lowerCmd");
                    string rCmd = ExtractJsonString(objJson, "raiseCmd");
                    if (!string.IsNullOrEmpty(lCmd)) nextLower[dId] = lCmd.ToUpper().Trim();
                    if (!string.IsNullOrEmpty(rCmd)) nextRaise[dId] = rCmd.ToUpper().Trim();
                }
                if (nextLower.Count > 0) dispenserLowerCmds = nextLower;
                if (nextRaise.Count > 0) dispenserRaiseCmds = nextRaise;
            }
        }
    }

    static void CloseValveAndRaiseAllLocked()
    {
        if (!isMachConnected || scripter == null) return;
        try
        {
            bool isReset = false;
            try { isReset = Convert.ToInt32(scripter.GetOEMLED(800)) != 0; } catch { }
            if (isReset) return;

            int waitMs = 0;
            while (waitMs < 400)
            {
                bool moving = false;
                try { moving = Convert.ToInt32(scripter.IsMoving()) != 0; } catch { }
                if (!moving) break;
                Thread.Sleep(40);
                waitMs += 40;
            }

            // Bezbednosna garancija: apsoluten koordinaten rezim (G90) pred mikro-cekor
            scripter.Code("G90");

            double baseX = 0;
            try { baseX = Convert.ToDouble(scripter.GetDRO(0)); } catch { }
            int feed = (defaultFeed > 0) ? defaultFeed : 3000;
            int stepDir = 1;

            if (!string.IsNullOrEmpty(valveCloseCmd))
            {
                double targetX = (stepDir == 1) ? (baseX + 0.001) : baseX;
                stepDir = -stepDir;
                scripter.Code(valveCloseCmd);
                scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", targetX, feed));
            }

            List<int> ids = new List<int>(dispenserRaiseCmds.Keys);
            ids.Sort();
            for (int i = 0; i < ids.Count; i++)
            {
                string rCmd = dispenserRaiseCmds[ids[i]];
                if (string.IsNullOrEmpty(rCmd)) continue;
                double targetX = (stepDir == 1) ? (baseX + 0.001) : baseX;
                stepDir = -stepDir;
                scripter.Code(rCmd);
                scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", targetX, feed));
            }

            if (stepDir == -1)
            {
                scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", baseX, feed));
            }
        }
        catch (Exception ex)
        {
            LogWarning("[SAFETY] Neuspesno isklucuvanje na izlezi: " + ex.Message);
        }
    }

    static bool MatchesCommandLine(string lineUpper, string cmdUpper)
    {
        if (string.IsNullOrEmpty(lineUpper) || string.IsNullOrEmpty(cmdUpper)) return false;
        return lineUpper == cmdUpper ||
               lineUpper.StartsWith(cmdUpper + " ") ||
               lineUpper.StartsWith(cmdUpper + "\t") ||
               lineUpper.StartsWith(cmdUpper + ";");
    }

    static void TrackCommandLineState(string lineUpper)
    {
        if (string.IsNullOrEmpty(lineUpper)) return;
        int commentIdx = lineUpper.IndexOf(';');
        string clean = (commentIdx >= 0 ? lineUpper.Substring(0, commentIdx) : lineUpper).Trim();
        if (string.IsNullOrEmpty(clean)) return;

        if (MatchesCommandLine(clean, valveOpenCmd))
        {
            valveOpen = true;
            return;
        }
        if (MatchesCommandLine(clean, valveCloseCmd))
        {
            valveOpen = false;
            return;
        }
        foreach (KeyValuePair<int, string> kvp in dispenserLowerCmds)
        {
            if (MatchesCommandLine(clean, kvp.Value))
            {
                if (!loweredDispensers.Contains(kvp.Key)) loweredDispensers.Add(kvp.Key);
                activeDispenserId = kvp.Key;
                return;
            }
        }
        foreach (KeyValuePair<int, string> kvp in dispenserRaiseCmds)
        {
            if (MatchesCommandLine(clean, kvp.Value))
            {
                loweredDispensers.Remove(kvp.Key);
                return;
            }
        }
    }

    static void BuildLineStatesForGcode(string normalizedGcode)
    {
        loadedLineStates.Clear();
        if (string.IsNullOrEmpty(normalizedGcode)) return;

        string[] rawLines = normalizedGcode.Split(new char[] { '\n' });
        bool simValve = false;
        List<int> simLowered = new List<int>();
        int simDisp = (activeDispenserId > 0) ? activeDispenserId : 1;

        for (int i = 0; i < rawLines.Length; i++)
        {
            string rawLine = rawLines[i].Trim();
            if (!string.IsNullOrEmpty(rawLine))
            {
                Match mDispTag = Regex.Match(rawLine, "\\[D(\\d+)\\]", RegexOptions.IgnoreCase);
                if (mDispTag.Success)
                {
                    int taggedId;
                    if (int.TryParse(mDispTag.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out taggedId) && taggedId > 0)
                    {
                        simDisp = taggedId;
                    }
                }

                string upperLine = rawLine.ToUpperInvariant();
                int commentIdx = upperLine.IndexOf(';');
                string clean = (commentIdx >= 0 ? upperLine.Substring(0, commentIdx) : upperLine).Trim();

                if (!string.IsNullOrEmpty(clean))
                {
                    if (MatchesCommandLine(clean, valveOpenCmd))
                    {
                        simValve = true;
                    }
                    else if (MatchesCommandLine(clean, valveCloseCmd))
                    {
                        simValve = false;
                    }
                    else if (Regex.IsMatch(clean, "\\bM0?(?:5|30)\\b"))
                    {
                        simValve = false;
                        simLowered.Clear();
                    }
                    else
                    {
                        bool matchedDisp = false;
                        foreach (KeyValuePair<int, string> kvp in dispenserLowerCmds)
                        {
                            if (MatchesCommandLine(clean, kvp.Value))
                            {
                                if (!simLowered.Contains(kvp.Key)) simLowered.Add(kvp.Key);
                                simDisp = kvp.Key;
                                matchedDisp = true;
                                break;
                            }
                        }
                        if (!matchedDisp)
                        {
                            foreach (KeyValuePair<int, string> kvp in dispenserRaiseCmds)
                            {
                                if (MatchesCommandLine(clean, kvp.Value))
                                {
                                    simLowered.Remove(kvp.Key);
                                    simDisp = kvp.Key;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            simLowered.Sort();
            LineMachState st = new LineMachState();
            st.ActiveDispenserId = simDisp;
            st.ValveOpen = simValve;
            st.LoweredDispensers = simLowered.ToArray();
            loadedLineStates.Add(st);
        }
    }

    static string EscapeJsonStr(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
    }

    static string BuildSnapshotJson(string errorMsg = null, bool loadedFlag = false)
    {
        lock (lockObj)
        {
            double x = 0, y = 0, feed = 0;
            int lineNum = 0;
            bool isMoving = false;
            bool isReset = false;
            bool isCycleStart = false;
            bool isHold = false;
            string status = "DISCONNECTED";

            if (isMachConnected && scripter != null)
            {
                try { x = Convert.ToDouble(scripter.GetDRO(0)); } catch { }
                try { y = Convert.ToDouble(scripter.GetDRO(1)); } catch { }
                try { feed = Convert.ToDouble(scripter.GetOEMDRO(818)); } catch { }
                try { lineNum = Convert.ToInt32(scripter.GetOEMDRO(816)); } catch { }

                try { isMoving = Convert.ToInt32(scripter.IsMoving()) != 0; } catch { }
                try { isReset = Convert.ToInt32(scripter.GetOEMLED(800)) != 0; } catch { }
                try { isCycleStart = Convert.ToInt32(scripter.GetOEMLED(804)) != 0; } catch { }
                try { isHold = Convert.ToInt32(scripter.GetOEMLED(805)) != 0; } catch { }

                if (isReset) status = "ESTOP";
                else if (isHold) status = "HOLD";
                else if (isMoving || isCycleStart) status = "RUNNING";
                else status = "IDLE";

                if (!string.IsNullOrEmpty(loadedFileName))
                {
                    try
                    {
                        string curMachFile = Convert.ToString(mach.FileName);
                        if (!string.IsNullOrEmpty(curMachFile) &&
                            !string.Equals(Path.GetFileName(curMachFile), Path.GetFileName(loadedFileName), StringComparison.OrdinalIgnoreCase))
                        {
                            loadedGcodeHash = "";
                            loadedLineStates.Clear();
                            activeFileJobRunning = false;
                        }
                    }
                    catch { }
                }

                // Zivo sledenje na aktiven dispenzer, spusten alat i ventil od vcitanata programa
                bool runningLoadedProgram = (loadedLineStates.Count > 0) &&
                    ((isCycleStart && (status == "RUNNING" || status == "HOLD")) ||
                     (activeFileJobRunning && (status == "RUNNING" || status == "HOLD")));

                if (runningLoadedProgram)
                {
                    if (isCycleStart) activeFileJobRunning = true;
                    int idx = (lineNum > 0) ? (lineNum - 1) : 0;
                    if (idx < 0) idx = 0;
                    if (idx >= loadedLineStates.Count) idx = loadedLineStates.Count - 1;

                    LineMachState st = loadedLineStates[idx];
                    activeDispenserId = st.ActiveDispenserId;
                    valveOpen = st.ValveOpen;
                    loweredDispensers = new List<int>(st.LoweredDispensers);
                }
                else if (activeFileJobRunning && status == "IDLE" && DateTime.UtcNow > fileJobGraceUntilUtc)
                {
                    activeFileJobRunning = false;
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
                else if (status == "ESTOP")
                {
                    activeFileJobRunning = false;
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
            }

            loweredDispensers.Sort();
            string loweredJson = "[" + string.Join(",", loweredDispensers.ToArray()) + "]";
            string errStr = string.IsNullOrEmpty(errorMsg) ? "null" : "\"" + EscapeJsonStr(errorMsg) + "\"";
            string hashJson = "\"" + EscapeJsonStr(loadedGcodeHash) + "\"";
            string fileJson = "\"" + EscapeJsonStr(loadedFileName) + "\"";

            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"status\":\"{0}\",\"mach3Connected\":{1},\"x\":{2:F3},\"y\":{3:F3},\"feedrate\":{4:F0},\"lineNum\":{5},\"totalLines\":{6},\"valveOpen\":{7},\"loweredDispensers\":{8},\"activeDispenserId\":{9},\"loaded\":{10},\"loadedGcodeHash\":{11},\"loadedFile\":{12},\"error\":{13}}}",
                status,
                isMachConnected ? "true" : "false",
                x, y, feed, lineNum, totalLines,
                valveOpen ? "true" : "false",
                loweredJson,
                activeDispenserId,
                loadedFlag ? "true" : "false",
                hashJson,
                fileJson,
                errStr
            );
        }
    }

    static string SaveGcodeToSafeTempFile(string normalizedGcode, out string errMsg)
    {
        errMsg = null;
        string tempDir = GetSafeTempDir();

        for (int attempt = 0; attempt < 10; attempt++)
        {
            int slot = Interlocked.Increment(ref gcodeFileSlot);
            if (slot > 1000000) gcodeFileSlot = 1;
            int slotNum = ((slot - 1) % 10) + 1;
            string candidate = Path.Combine(tempDir, string.Format(CultureInfo.InvariantCulture, "job_{0}.tap", slotNum));

            try
            {
                using (var fs = new FileStream(candidate, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                using (var writer = new StreamWriter(fs, new UTF8Encoding(false)))
                {
                    writer.Write(normalizedGcode);
                    writer.Flush();
                }
                return candidate;
            }
            catch (IOException ioEx)
            {
                LogWarning("[FILE] Datotekata " + Path.GetFileName(candidate) + " e zafatena od Mach3, prefrlanje na sleden slot (" + ioEx.Message + ")");
                continue;
            }
            catch (Exception ex)
            {
                errMsg = "Greska pri zapisuvanje na " + Path.GetFileName(candidate) + ": " + ex.Message;
                LogError("[FILE GRESKA] " + errMsg);
                return null;
            }
        }

        try
        {
            string guidFile = Path.Combine(tempDir, string.Format(CultureInfo.InvariantCulture, "job_{0}_{1}.tap",
                DateTime.Now.ToString("HHmmss"),
                Guid.NewGuid().ToString("N").Substring(0, 4)));

            using (var fs = new FileStream(guidFile, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
            using (var writer = new StreamWriter(fs, new UTF8Encoding(false)))
            {
                writer.Write(normalizedGcode);
                writer.Flush();
            }
            return guidFile;
        }
        catch (Exception ex)
        {
            errMsg = "Site slotovi za privremena datoteka bea blokirani: " + ex.Message;
            LogError("[FILE GRESKA] " + errMsg);
            return null;
        }
    }

    static bool LoadGcodeIntoMach3Locked(string gcode, string gcodeHash, out string errMsg)
    {
        errMsg = null;
        if (!isMachConnected || scripter == null)
        {
            errMsg = "Mach3 ne e povrzan.";
            return false;
        }
        if (string.IsNullOrEmpty(gcode))
        {
            errMsg = "Prazniot G-kod ne moze da se vcita vo Mach3.";
            return false;
        }

        try
        {
            string normalized = gcode.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\r\n");
            string tempFile = SaveGcodeToSafeTempFile(normalized, out errMsg);
            if (string.IsNullOrEmpty(tempFile) || !File.Exists(tempFile))
            {
                if (string.IsNullOrEmpty(errMsg)) errMsg = "Neuspesno kreiranje na privremena .tap datoteka.";
                return false;
            }

            totalLines = normalized.Split(new char[] { '\n' }, StringSplitOptions.RemoveEmptyEntries).Length;
            loadedGcodeHash = "";
            loadedFileName = tempFile;
            activeFileJobRunning = false;
            BuildLineStatesForGcode(normalized);

            scripter.LoadFile(tempFile);
            Thread.Sleep(180);

            int maxWaitMs = 15000;
            int waited = 0;
            while (Convert.ToInt32(scripter.IsLoading()) != 0 && waited < maxWaitMs)
            {
                Thread.Sleep(50);
                waited += 50;
            }

            if (Convert.ToInt32(scripter.IsLoading()) != 0)
            {
                errMsg = "Istece vremeto pri vcituvanje na G-kodot vo Mach3.";
                loadedLineStates.Clear();
                return false;
            }

            Thread.Sleep(120);

            try
            {
                string machFile = Convert.ToString(mach.FileName);
                string expectedBaseName = Path.GetFileName(tempFile);
                if (!string.IsNullOrEmpty(machFile) &&
                    machFile.IndexOf(expectedBaseName, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    LogWarning("[LOAD] Mach3 FileName vrati: " + machFile + " (ocekuvano: " + expectedBaseName + ")");
                }
            }
            catch { }

            loadedGcodeHash = string.IsNullOrEmpty(gcodeHash) ? ("L" + totalLines) : gcodeHash;
            LogSuccess("[LOAD] G-kodot e vcitan vo Mach3 (" + totalLines + " reda, datoteka: " + tempFile + ").");
            return true;
        }
        catch (Exception ex)
        {
            errMsg = "Greska pri vcituvanje vo Mach3: " + ex.Message;
            LogError("[LOAD GRESKA] " + ex.Message);
            loadedLineStates.Clear();
            return false;
        }
    }

    static bool StartLoadedInMach3Locked(out string errMsg)
    {
        errMsg = null;
        if (!isMachConnected || scripter == null)
        {
            errMsg = "Mach3 ne e povrzan.";
            return false;
        }

        try
        {
            bool isReset = false;
            try { isReset = Convert.ToInt32(scripter.GetOEMLED(800)) != 0; } catch { }
            if (isReset)
            {
                errMsg = "Mach3 e vo RESET / E-STOP sostojba! Pritisnete RESET prvo.";
                return false;
            }

            if (totalLines <= 0 || string.IsNullOrEmpty(loadedFileName))
            {
                errMsg = "Vo Mach3 nema vcitan G-kod od aplikacijata.";
                return false;
            }

            bool isHold = false;
            try { isHold = Convert.ToInt32(scripter.GetOEMLED(805)) != 0; } catch { }
            if (!isHold)
            {
                scripter.DoOEMButton(1002);
                Thread.Sleep(100);
            }

            activeFileJobRunning = true;
            fileJobGraceUntilUtc = DateTime.UtcNow.AddMilliseconds(1400);
            if (loadedLineStates.Count > 0)
            {
                activeDispenserId = loadedLineStates[0].ActiveDispenserId;
            }

            scripter.DoOEMButton(1000);
            Thread.Sleep(120);
            LogSuccess("[RUN] Startuvano izvrsuvanje vo Mach3 (Cycle Start).");
            return true;
        }
        catch (Exception ex)
        {
            activeFileJobRunning = false;
            errMsg = "Greska pri startuvanje na Mach3: " + ex.Message;
            LogError("[RUN GRESKA] " + ex.Message);
            return false;
        }
    }

    static void Main(string[] args)
    {
        Console.Title = "Mach3 Driver Bridge V2.3 (Port: " + PORT + ")";
        InitDefaultCmds();

        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            LogError("\n[GRESKA]: " + e.ExceptionObject.ToString());
            Console.ReadLine();
        };

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("===============================================================");
        Console.WriteLine("         MACH3 POSVETEN MOST ZA CNC DISPENSER (V2.3)           ");
        Console.WriteLine("===============================================================");
        Console.ResetColor();

        EnsureMach3();

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + PORT + "/");
        listener.Prefixes.Add("http://localhost:" + PORT + "/");

        try
        {
            listener.Start();
            LogSuccess("[MREZA] Bridzot slusa na: http://127.0.0.1:" + PORT + "/");
            Console.WriteLine("[TEMP]  G-Code path / dir: " + GetSafeTempDir());
            Console.WriteLine("---------------------------------------------------------------\n");
        }
        catch (Exception ex)
        {
            LogError("[GRESKA] Portata e zafatena ili nema Admin prava: " + ex.Message);
            Console.ReadLine();
            return;
        }

        while (true)
        {
            try
            {
                HttpListenerContext context = listener.GetContext();
                ProcessRequest(context);
            }
            catch { }
        }
    }

    static void ProcessRequest(HttpListenerContext context)
    {
        HttpListenerRequest req = context.Request;
        HttpListenerResponse res = context.Response;

        try
        {
            string origin = req.Headers["Origin"];
            if (IsTrustedOrigin(origin))
            {
                res.AddHeader("Access-Control-Allow-Origin", origin);
                res.AddHeader("Vary", "Origin");
            }
            res.AddHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Origin, Accept, X-Bridge-Token");
            res.AddHeader("Access-Control-Max-Age", "300");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 200;
                res.Close();
                return;
            }

            string rawUrl = req.Url.AbsolutePath.ToLower();
            string time = DateTime.Now.ToString("HH:mm:ss");

            EnsureMach3();

            if (rawUrl.EndsWith("/bridge_token") && req.HttpMethod == "GET")
            {
                SendJson(res, "{\"token\":\"" + bridgeToken + "\"}");
                return;
            }

            bool stateChangingPost =
                req.HttpMethod == "POST" &&
                (rawUrl.EndsWith("/temp/autosave")
                    || rawUrl.EndsWith("/config")
                    || rawUrl.EndsWith("/load_gcode")
                    || rawUrl.EndsWith("/load_and_run")
                    || rawUrl.EndsWith("/run_loaded")
                    || rawUrl.EndsWith("/pause")
                    || rawUrl.EndsWith("/resume")
                    || rawUrl.EndsWith("/stop")
                    || rawUrl.EndsWith("/reset")
                    || rawUrl.EndsWith("/jog")
                    || rawUrl.EndsWith("/zero")
                    || rawUrl.EndsWith("/mdi"));

            if (stateChangingPost && !IsAuthorizedBridgeRequest(req))
            {
                SendJson(res, "{\"error\":\"Unauthorized bridge request.\"}", 403);
                return;
            }

            string body = "";
            if (req.HasEntityBody)
            {
                using (var reader = new StreamReader(req.InputStream, Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }
            }

            // 1. GET /status
            if (rawUrl.EndsWith("/status") && req.HttpMethod == "GET")
            {
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 1B. GET / POST /temp/autosave (Crash Recovery bekap na disk)
            if (rawUrl.EndsWith("/temp/autosave"))
            {
                string autoPath = GetAutosaveFilePath();
                if (req.HttpMethod == "GET")
                {
                    if (File.Exists(autoPath))
                    {
                        string savedJson = File.ReadAllText(autoPath, Encoding.UTF8);
                        SendJson(res, string.IsNullOrEmpty(savedJson) ? "{}" : savedJson);
                    }
                    else
                    {
                        SendJson(res, "{}");
                    }
                    return;
                }
                if (req.HttpMethod == "POST")
                {
                    if (!string.IsNullOrEmpty(body))
                    {
                        string tmpPath = autoPath + ".tmp";
                        File.WriteAllText(tmpPath, body, new UTF8Encoding(false));
                        File.Copy(tmpPath, autoPath, true);
                        try { File.Delete(tmpPath); } catch { }
                    }
                    SendJson(res, "{\"ok\":true}");
                    return;
                }
            }

            // 2. POST /config
            if (rawUrl.EndsWith("/config") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [CONFIG] Sinhronizacija na komandi so aplikacijata.");
                lock (lockObj)
                {
                    ApplyConfigFromBody(body);
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 3A. POST /load_gcode
            if (rawUrl.EndsWith("/load_gcode") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [LOAD] Vcituvanje na G-kod vo Mach3...");
                string gcode = ExtractJsonString(body, "gcode") ?? "";
                string gcodeHash = ExtractJsonString(body, "gcodeHash") ?? "";

                string loadErr = null;
                bool ok = false;
                lock (lockObj)
                {
                    ApplyConfigFromBody(body);
                    ok = LoadGcodeIntoMach3Locked(gcode, gcodeHash, out loadErr);
                }
                if (!ok)
                {
                    SendJson(res, BuildSnapshotJson(loadErr, false), 400);
                    return;
                }
                SendJson(res, BuildSnapshotJson(null, true));
                return;
            }

            // 3B. POST /run_loaded
            if (rawUrl.EndsWith("/run_loaded") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [RUN_LOADED] Start na veke vcitan G-kod.");
                string runErr = null;
                bool ok = false;
                lock (lockObj)
                {
                    ok = StartLoadedInMach3Locked(out runErr);
                }
                if (!ok)
                {
                    SendJson(res, BuildSnapshotJson(runErr, !string.IsNullOrEmpty(loadedGcodeHash)), 400);
                    return;
                }
                SendJson(res, BuildSnapshotJson(null, true));
                return;
            }

            // 3C. POST /load_and_run
            if (rawUrl.EndsWith("/load_and_run") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [LOAD_AND_RUN] Vcituvanje i start na G-kod!");
                string gcode = ExtractJsonString(body, "gcode") ?? "";
                string gcodeHash = ExtractJsonString(body, "gcodeHash") ?? "";

                string errMsg = null;
                bool ok = false;
                lock (lockObj)
                {
                    ApplyConfigFromBody(body);
                    ok = LoadGcodeIntoMach3Locked(gcode, gcodeHash, out errMsg);
                    if (ok)
                    {
                        ok = StartLoadedInMach3Locked(out errMsg);
                    }
                }
                if (!ok)
                {
                    SendJson(res, BuildSnapshotJson(errMsg, false), 400);
                    return;
                }
                SendJson(res, BuildSnapshotJson(null, true));
                return;
            }

            // 4. KONTROLI: /pause, /resume, /stop, /reset
            if (rawUrl.EndsWith("/pause") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] PAUSE");
                lock (lockObj) { if (isMachConnected && scripter != null) scripter.DoOEMButton(1001); }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/resume") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] RESUME");
                lock (lockObj) { if (isMachConnected && scripter != null) scripter.DoOEMButton(1000); }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/stop") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] STOP -> Stopiranje ciklus, zatvoranje ventil i krenuvanje dizni");
                lock (lockObj)
                {
                    ApplyConfigFromBody(body);
                    activeFileJobRunning = false;
                    if (isMachConnected && scripter != null)
                    {
                        scripter.DoOEMButton(1003);
                        Thread.Sleep(100);
                        CloseValveAndRaiseAllLocked();
                    }
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/reset") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] RESET (Mach3 OEM 1021)");
                lock (lockObj)
                {
                    ApplyConfigFromBody(body);
                    activeFileJobRunning = false;
                    if (isMachConnected && scripter != null)
                    {
                        bool wasReset = false;
                        try { wasReset = Convert.ToInt32(scripter.GetOEMLED(800)) != 0; } catch { }
                        if (!wasReset)
                        {
                            CloseValveAndRaiseAllLocked();
                            Thread.Sleep(60);
                            scripter.DoOEMButton(1021);
                        }
                        else
                        {
                            scripter.DoOEMButton(1021);
                            Thread.Sleep(120);
                            CloseValveAndRaiseAllLocked();
                        }
                    }
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 5. POST /jog
            if (rawUrl.EndsWith("/jog") && req.HttpMethod == "POST")
            {
                string axis = (ExtractJsonString(body, "axis") ?? "").ToUpper().Trim();
                double step = ExtractJsonDouble(body, "step", 0.0);
                if ((axis == "X" || axis == "Y") && Math.Abs(step) > 0.00001)
                {
                    lock (lockObj)
                    {
                        if (isMachConnected && scripter != null)
                        {
                            double cur = 0;
                            try { cur = Convert.ToDouble(scripter.GetDRO(axis == "X" ? 0 : 1)); } catch { }
                            double target = Math.Round(cur + step, 3);
                            string jogGCode = string.Format(CultureInfo.InvariantCulture, "G90 G0 {0}{1:F3}", axis, target);
                            Console.WriteLine("[" + time + "] [JOG] (DRO=" + cur.ToString("F3", CultureInfo.InvariantCulture) + ", step=" + step.ToString("F3", CultureInfo.InvariantCulture) + ") -> " + jogGCode);
                            scripter.Code(jogGCode);
                        }
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 6. POST /zero
            if (rawUrl.EndsWith("/zero") && req.HttpMethod == "POST")
            {
                string axis = (ExtractJsonString(body, "axis") ?? "").ToUpper().Trim();
                if (!string.IsNullOrEmpty(axis))
                {
                    Console.WriteLine("[" + time + "] [ZERO] Nuliranje na oska " + axis);
                    lock (lockObj)
                    {
                        if (isMachConnected && scripter != null)
                        {
                            if (axis == "X") scripter.DoOEMButton(1007);
                            else if (axis == "Y") scripter.DoOEMButton(1008);
                            else if (axis == "XY" || axis == "ALL")
                            {
                                scripter.DoOEMButton(1007);
                                scripter.DoOEMButton(1008);
                            }
                            else if (axis == "Z") scripter.DoOEMButton(1009);
                        }
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 7. POST /mdi
            if (rawUrl.EndsWith("/mdi") && req.HttpMethod == "POST")
            {
                string cmd = ExtractJsonString(body, "cmd");
                if (cmd != null)
                {
                    Console.WriteLine("[" + time + "] [MDI] " + cmd.Replace("\r", "").Replace("\n", " | "));

                    lock (lockObj)
                    {
                        double baseX = 0;
                        if (isMachConnected && scripter != null)
                        {
                            try { baseX = Convert.ToDouble(scripter.GetDRO(0)); } catch { }
                        }

                        if (cmd == "RAISE_ALL")
                        {
                            double feedVal = ExtractJsonDouble(body, "feed", 3000);
                            int feed = Math.Max(1, (int)Math.Round(feedVal));
                            MatchCollection mRaises = Regex.Matches(body, "\"raiseCmds\"\\s*:\\s*\\[([^\\]]+)\\]");
                            if (mRaises.Count > 0)
                            {
                                if (isMachConnected && scripter != null) scripter.Code("G90");
                                string inside = mRaises[0].Groups[1].Value;
                                int stepDir = 1;
                                foreach (Match sub in Regex.Matches(inside, "\"([^\"]+)\""))
                                {
                                    if (isMachConnected && scripter != null)
                                    {
                                        string rCmd = UnescapeJsonString(sub.Groups[1].Value).Trim();
                                        if (string.IsNullOrEmpty(rCmd)) continue;
                                        double targetX = (stepDir == 1) ? (baseX + 0.001) : baseX;
                                        stepDir = -stepDir;
                                        scripter.Code(rCmd);
                                        scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", targetX, feed));
                                    }
                                }
                            }
                            loweredDispensers.Clear();
                        }
                        else if (cmd.StartsWith("PULSE:"))
                        {
                            int duration = 100;
                            int.TryParse(cmd.Substring(6), out duration);
                            if (duration <= 0) duration = 100;
                            if (duration > 5000) duration = 5000;

                            string pOpen = ExtractJsonString(body, "openCmd");
                            string pClose = ExtractJsonString(body, "closeCmd");
                            if (string.IsNullOrEmpty(pOpen)) pOpen = valveOpenCmd;
                            if (string.IsNullOrEmpty(pClose)) pClose = valveCloseCmd;
                            double feedVal = ExtractJsonDouble(body, "feed", 3000);
                            int feed = Math.Max(1, (int)Math.Round(feedVal));

                            if (isMachConnected && scripter != null)
                            {
                                scripter.Code("G90");
                                scripter.Code(pOpen);
                                scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", baseX + 0.001, feed));
                                Thread.Sleep(duration + 40);
                                scripter.Code(pClose);
                                scripter.Code(string.Format(CultureInfo.InvariantCulture, "G1 X{0:F3} F{1}", baseX, feed));
                            }
                            valveOpen = false;
                        }
                        else
                        {
                            string[] lines = cmd.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                            foreach (string line in lines)
                            {
                                string trimmed = line.Trim();
                                if (string.IsNullOrEmpty(trimmed)) continue;

                                string upperLine = trimmed.ToUpper();
                                if (isMachConnected && scripter != null)
                                {
                                    scripter.Code(trimmed);
                                    if (upperLine.StartsWith("G4 ") || upperLine.StartsWith("G4P"))
                                    {
                                        Match mp = Regex.Match(upperLine, "P\\s*([0-9]+(?:\\.[0-9]+)?)");
                                        if (mp.Success)
                                        {
                                            double pMs;
                                            if (double.TryParse(mp.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out pMs))
                                            {
                                                int sleepMs = (int)Math.Round(pMs);
                                                if (sleepMs > 0 && sleepMs <= 5000)
                                                {
                                                    Thread.Sleep(sleepMs);
                                                }
                                            }
                                        }
                                    }
                                }
                                TrackCommandLineState(upperLine);
                            }
                        }
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 8. Servisiranje staticki datoteki (index.html, js, css, json, svg)
            string baseDirFull = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            string filename = (rawUrl == "/" ? "index.html" : rawUrl.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
            string localFilePath = Path.GetFullPath(Path.Combine(baseDirFull, filename));

            if (localFilePath.StartsWith(baseDirFull, StringComparison.OrdinalIgnoreCase) && File.Exists(localFilePath))
            {
                byte[] fileBytes = File.ReadAllBytes(localFilePath);
                string contentType = "application/octet-stream";
                if (localFilePath.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) contentType = "text/html; charset=utf-8";
                else if (localFilePath.EndsWith(".js", StringComparison.OrdinalIgnoreCase)) contentType = "application/javascript; charset=utf-8";
                else if (localFilePath.EndsWith(".css", StringComparison.OrdinalIgnoreCase)) contentType = "text/css; charset=utf-8";
                else if (localFilePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) contentType = "application/json; charset=utf-8";
                else if (localFilePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) contentType = "image/svg+xml; charset=utf-8";
                else if (localFilePath.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) contentType = "text/plain; charset=utf-8";

                res.ContentType = contentType;
                res.ContentLength64 = fileBytes.Length;
                res.OutputStream.Write(fileBytes, 0, fileBytes.Length);
                res.OutputStream.Close();
                return;
            }

            // Dokolku pobaranata staticka datoteka ne postoi, vrati cist 404 Not Found
            res.StatusCode = 404;
            res.ContentType = "text/plain; charset=utf-8";
            byte[] notFoundBytes = Encoding.UTF8.GetBytes("404 Not Found: " + filename);
            res.ContentLength64 = notFoundBytes.Length;
            res.OutputStream.Write(notFoundBytes, 0, notFoundBytes.Length);
            res.OutputStream.Close();
            return;
        }
        catch (Exception ex)
        {
            LogError("[HTTP GRESKA] " + ex.Message);
            try
            {
                SendJson(res, BuildSnapshotJson(ex.Message, false), 500);
            }
            catch
            {
                try { res.Close(); } catch { }
            }
        }
    }

    static void SendJson(HttpListenerResponse res, string json, int statusCode = 200)
    {
        byte[] buffer = Encoding.UTF8.GetBytes(json);
        res.StatusCode = statusCode;
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = buffer.Length;
        res.OutputStream.Write(buffer, 0, buffer.Length);
        res.OutputStream.Close();
    }

    static void LogSuccess(string msg) { Console.ForegroundColor = ConsoleColor.Green; Console.WriteLine(msg); Console.ResetColor(); }
    static void LogWarning(string msg) { Console.ForegroundColor = ConsoleColor.Yellow; Console.WriteLine(msg); Console.ResetColor(); }
    static void LogError(string msg) { Console.ForegroundColor = ConsoleColor.Red; Console.WriteLine(msg); Console.ResetColor(); }
}