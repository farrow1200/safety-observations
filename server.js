diff --git a/server.js b/server.js
index 2250e11f2523a1e72901290d38fc76d75ec931fb..b59fcf544a3d5977ad451f7cd2ce871809d55298 100644
--- a/server.js
+++ b/server.js
@@ -1,220 +1,313 @@
 const ExcelJS = require("exceljs");
 const express = require("express");
 const bodyParser = require("body-parser");
 const sqlite3 = require("sqlite3").verbose();
 const cron = require("node-cron");
 require("dotenv").config();
 const { Resend } = require("resend");
-console.log("RESEND KEY EXISTS:", !!process.env.RESEND_API_KEY);
-console.log("RESEND KEY CHECK:", process.env.RESEND_API_KEY);
-
-const resend = new Resend(process.env.RESEND_API_KEY);
-
 
 const app = express();
+const resend = new Resend(process.env.RESEND_API_KEY);
 
 app.use(bodyParser.json());
 app.use(express.static(__dirname));
 
-const db = new sqlite3.Database("./safety.db");
-
-// ================= EMAIL =================
-console.log("RESEND KEY CHECK:", process.env.RESEND_API_KEY);
-
-// ================= DATABASE =================
-db.run(`
-CREATE TABLE IF NOT EXISTS observations (
- id INTEGER PRIMARY KEY AUTOINCREMENT,
- name TEXT,
- department TEXT,
- description TEXT,
- fix TEXT,
- status TEXT,
- date TEXT
-)
-`);
-
-// ================= ADD OBS =================
-app.post("/add", (req, res) => {
+app.get("/health", (req, res) => {
+ res.status(200).send("ok");
+});
 
- const obs = req.body;
- const date = new Date().toISOString().split("T")[0];
+const useJsonBin = !!(process.env.JSONBIN_API_KEY && process.env.JSONBIN_BIN_ID);
+const db = new sqlite3.Database("./safety.db");
 
- db.run(
-  `INSERT INTO observations
-  (name,department,description,fix,status,date)
-  VALUES (?,?,?,?,?,?)`,
-  [
-   obs.name,
-   obs.department,
-   obs.description,
-   obs.fix,
-   obs.status,
-   date
-  ],
-  async function (err) {
+async function jsonBinGetObservations() {
+ const response = await fetch(
+  `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`,
+  {
+   headers: {
+    "X-Master-Key": process.env.JSONBIN_API_KEY
+   }
+  }
+ );
 
-   if (err) return res.status(500).send("db error");
-// EMAIL NEW OBSERVATION
-try {
+ if (!response.ok) {
+  throw new Error(`JSONBin GET failed: ${response.status}`);
+ }
 
- await resend.emails.send({
+ const data = await response.json();
+ return Array.isArray(data.record?.observations) ? data.record.observations : [];
+}
 
-  from: "onboarding@resend.dev",
+async function jsonBinSaveObservations(observations) {
+ const response = await fetch(
+  `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`,
+  {
+   method: "PUT",
+   headers: {
+    "Content-Type": "application/json",
+    "X-Master-Key": process.env.JSONBIN_API_KEY
+   },
+   body: JSON.stringify({ observations })
+  }
+ );
 
-  to: [
-   "n05669169@gmail.com"
+ if (!response.ok) {
+  throw new Error(`JSONBin PUT failed: ${response.status}`);
+ }
+}
 
-  ],
+function sqliteRun(query, params = []) {
+ return new Promise((resolve, reject) => {
+  db.run(query, params, function (err) {
+   if (err) return reject(err);
+   resolve(this);
+  });
+ });
+}
 
-  subject: "🚨 New Safety Observation Submitted",
+function sqliteAll(query, params = []) {
+ return new Promise((resolve, reject) => {
+  db.all(query, params, (err, rows) => {
+   if (err) return reject(err);
+   resolve(rows);
+  });
+ });
+}
 
-  text:
-   "Employee: " + obs.name +
-   "\nDepartment: " + obs.department +
-   "\nObservation: " + obs.description +
-   "\nFix: " + obs.fix +
-   "\nStatus: " + obs.status +
-   "\nDate: " + date
+async function initDb() {
+ if (useJsonBin) {
+  console.log("DATABASE: JSONBin (free persistent storage)");
+  return;
+ }
+
+ await sqliteRun(`
+ CREATE TABLE IF NOT EXISTS observations (
+  id INTEGER PRIMARY KEY AUTOINCREMENT,
+  name TEXT,
+  department TEXT,
+  description TEXT,
+  fix TEXT,
+  status TEXT,
+  date TEXT
+ )
+ `);
+ console.log("DATABASE: SQLite local file ./safety.db");
+}
 
- });
+async function getObservations() {
+ if (useJsonBin) {
+  return jsonBinGetObservations();
+ }
 
- console.log("OBSERVATION EMAIL SENT");
+ return sqliteAll("SELECT * FROM observations ORDER BY id DESC");
+}
 
-} catch(err) {
+async function addObservation(obs, date) {
+ if (useJsonBin) {
+  const observations = await jsonBinGetObservations();
+  const maxId = observations.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
+
+  observations.unshift({
+   id: maxId + 1,
+   name: obs.name,
+   department: obs.department,
+   description: obs.description,
+   fix: obs.fix,
+   status: obs.status,
+   date
+  });
 
- console.log("EMAIL ERROR:", err);
+  await jsonBinSaveObservations(observations);
+  return;
+ }
 
+ await sqliteRun(
+  `INSERT INTO observations
+  (name,department,description,fix,status,date)
+  VALUES (?,?,?,?,?,?)`,
+  [obs.name, obs.department, obs.description, obs.fix, obs.status, date]
+ );
 }
 
+async function updateObservation(id, status, fix) {
+ if (useJsonBin) {
+  const observations = await jsonBinGetObservations();
+  const next = observations.map((row) =>
+   String(row.id) === String(id)
+    ? { ...row, status, fix }
+    : row
+  );
 
+  await jsonBinSaveObservations(next);
+  return;
+ }
 
-   
+ await sqliteRun(
+  `UPDATE observations SET status=?,fix=? WHERE id=?`,
+  [status, fix, id]
+ );
+}
 
+async function getOpenObservations() {
+ if (useJsonBin) {
+  const observations = await jsonBinGetObservations();
+  return observations.filter((row) => row.status !== "Closed");
+ }
 
+ return sqliteAll("SELECT * FROM observations WHERE status!='Closed'");
+}
 
-   res.send("ok");
+// ================= ADD OBS =================
+app.post("/add", async (req, res) => {
+ try {
+  const obs = req.body;
+  const date = new Date().toISOString().split("T")[0];
+
+  await addObservation(obs, date);
+
+  try {
+   await resend.emails.send({
+    from: "onboarding@resend.dev",
+    to: ["n05669169@gmail.com"],
+    subject: "🚨 New Safety Observation Submitted",
+    text:
+     "Employee: " + obs.name +
+     "\nDepartment: " + obs.department +
+     "\nObservation: " + obs.description +
+     "\nFix: " + obs.fix +
+     "\nStatus: " + obs.status +
+     "\nDate: " + date
+   });
+   console.log("OBSERVATION EMAIL SENT");
+  } catch (err) {
+   console.log("EMAIL ERROR:", err);
   }
- );
+
+  res.send("ok");
+ } catch (err) {
+  console.log("DB ERROR:", err);
+  res.status(500).send("db error");
+ }
 });
 
 // ================= GET DATA =================
-app.get("/data",(req,res)=>{
- db.all("SELECT * FROM observations",(err,rows)=>{
-  if(err) return res.status(500).send("db error");
+app.get("/data", async (req, res) => {
+ try {
+  const rows = await getObservations();
   res.json(rows);
- });
+ } catch (err) {
+  console.log("DB ERROR:", err);
+  res.status(500).send("db error");
+ }
 });
 
 // ================= UPDATE OBS =================
-app.put("/update/:id",(req,res)=>{
-
- const id=req.params.id;
-
- db.run(
-  `UPDATE observations SET status=?,fix=? WHERE id=?`,
-  [req.body.status,req.body.fix,id],
-  async (err)=>{
-
-   if(err) return res.status(500).send("update error");
-
-   try{
-    await resend.emails.send({
-     from:"onboarding@resend.dev",
-     to:["n05669169@gmail.com"],
-     subject:"Observation Closed",
-     text:"Observation "+id+" was closed."
-    });
-   }catch(e){
-    console.log("EMAIL ERROR:",e.message);
-   }
-
-   res.send("updated");
+app.put("/update/:id", async (req, res) => {
+ const id = req.params.id;
+
+ try {
+  await updateObservation(id, req.body.status, req.body.fix);
+
+  try {
+   await resend.emails.send({
+    from: "onboarding@resend.dev",
+    to: ["n05669169@gmail.com"],
+    subject: "Observation Closed",
+    text: "Observation " + id + " was closed."
+   });
+  } catch (e) {
+   console.log("EMAIL ERROR:", e.message);
   }
- );
+
+  res.send("updated");
+ } catch (err) {
+  console.log("UPDATE ERROR:", err);
+  res.status(500).send("update error");
+ }
 });
 
 // ================= EXPORT EXCEL =================
-app.get("/export", async (req,res)=>{
-
- const workbook=new ExcelJS.Workbook();
- const sheet=workbook.addWorksheet("Observations");
-
- sheet.columns=[
-  {header:"Name",key:"name"},
-  {header:"Department",key:"department"},
-  {header:"Observation",key:"description"},
-  {header:"Fix",key:"fix"},
-  {header:"Status",key:"status"},
-  {header:"Date",key:"date"}
- ];
-
- db.all("SELECT * FROM observations", async(err,rows)=>{
-
-  if(err) return res.status(500).send("db error");
-
-  rows.forEach(r=>sheet.addRow(r));
+app.get("/export", async (req, res) => {
+ try {
+  const workbook = new ExcelJS.Workbook();
+  const sheet = workbook.addWorksheet("Observations");
+
+  sheet.columns = [
+   { header: "Name", key: "name" },
+   { header: "Department", key: "department" },
+   { header: "Observation", key: "description" },
+   { header: "Fix", key: "fix" },
+   { header: "Status", key: "status" },
+   { header: "Date", key: "date" }
+  ];
+
+  const rows = await getObservations();
+  rows.forEach((r) => sheet.addRow(r));
 
   res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
   );
 
   res.setHeader(
    "Content-Disposition",
    "attachment; filename=observations.xlsx"
   );
 
   await workbook.xlsx.write(res);
   res.end();
- });
+ } catch (err) {
+  console.log("EXPORT ERROR:", err);
+  res.status(500).send("db error");
+ }
 });
 
 // ================= WEEKLY OVERDUE EMAIL =================
-cron.schedule("0 8 * * 1",()=>{
-
- db.all(
-  "SELECT * FROM observations WHERE status!='Closed'",
-  async (err,rows)=>{
-
-   if(err) return;
-
-   let overdueList="";
+cron.schedule("0 8 * * 1", async () => {
+ try {
+  const rows = await getOpenObservations();
+  let overdueList = "";
+
+  rows.forEach((o) => {
+   const today = new Date();
+   const obsDate = new Date(o.date);
+   const diff = (today - obsDate) / (1000 * 60 * 60 * 24);
+
+   if (diff > 7) {
+    overdueList +=
+     "Name: " + o.name +
+     "\nDept: " + o.department +
+     "\nObservation: " + o.description +
+     "\nDate: " + o.date + "\n\n";
+   }
+  });
 
-   rows.forEach(o=>{
-    const today=new Date();
-    const obsDate=new Date(o.date);
-    const diff=(today-obsDate)/(1000*60*60*24);
+  if (overdueList === "") return;
 
-    if(diff>7){
-     overdueList+=
-      "Name: "+o.name+
-      "\nDept: "+o.department+
-      "\nObservation: "+o.description+
-      "\nDate: "+o.date+"\n\n";
-    }
+  try {
+   await resend.emails.send({
+    from: "onboarding@resend.dev",
+    to: ["n05669169@gmail.com"],
+    subject: "Overdue Safety Observations",
+    text: overdueList
    });
-
-   if(overdueList==="") return;
-
-   try{
-    await resend.emails.send({
-     from:"onboarding@resend.dev",
-     to:["n05669169@gmail.com"],
-     subject:"Overdue Safety Observations",
-     text:overdueList
-    });
-   }catch(e){
-    console.log("EMAIL ERROR:",e.message);
-   }
-
+  } catch (e) {
+   console.log("EMAIL ERROR:", e.message);
   }
- );
+ } catch (err) {
+  console.log("CRON ERROR:", err);
+ }
 });
 
 // ================= START SERVER =================
 const PORT = process.env.PORT || 3000;
 
-app.listen(PORT,()=>{
- console.log("Server running on port",PORT);
-});
+initDb()
+ .then(() => {
+  app.listen(PORT, () => {
+   console.log("Server running on port", PORT);
+  });
+ })
+ .catch((err) => {
+  console.error("Failed to initialize DB", err);
+  process.exit(1);
+ });
