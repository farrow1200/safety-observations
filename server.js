const ExcelJS = require("exceljs");
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const cron = require("node-cron");

const app = express();

app.use(bodyParser.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./safety.db");


// ================= EMAIL =================
const transporter = nodemailer.createTransport({
 service: "gmail",
 auth: {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS
 }
});


// ================= DATABASE =================
db.run(`
CREATE TABLE IF NOT EXISTS observations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT,
 department TEXT,
 description TEXT,
 fix TEXT,
 status TEXT,
 date TEXT
)
`);


// ================= ADD OBS =================
app.post("/add", (req, res) => {

 const obs = req.body;
 const date = new Date().toISOString().split("T")[0];

 db.run(
  `INSERT INTO observations
  (name,department,description,fix,status,date)
  VALUES (?,?,?,?,?,?)`,
  [
   obs.name,
   obs.department,
   obs.description,
   obs.fix,
   obs.status,
   date
  ],
  function (err) {

   if (err) {
    console.log(err);
    return res.status(500).send("db error");
   }

   // EMAIL NEW OBS
   transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nicholas.farrow@sms-group.com",
    subject: "New Safety Observation",
    text:
     "Employee: " + obs.name +
     "\nDept: " + obs.department +
     "\nObservation: " + obs.description +
     "\nStatus: " + obs.status
   }, (err) => {
    if (err) console.log("EMAIL ERROR:", err);
   });

   res.send("ok");
  }
 );
});


// ================= GET DATA =================
app.get("/data", (req, res) => {
 db.all("SELECT * FROM observations", (err, rows) => {
  if (err) return res.status(500).send("db error");
  res.json(rows);
 });
});


// ================= UPDATE OBS =================
app.put("/update/:id", (req, res) => {

 const id = req.params.id;

 db.run(
  `UPDATE observations SET status=?,fix=? WHERE id=?`,
  [req.body.status, req.body.fix, id],
  (err) => {

   if (err) return res.status(500).send("update error");

   transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nicholas.farrow@sms-group.com",
    subject: "Observation Closed",
    text: "Observation " + id + " was closed."
   }, (err) => {
    if (err) console.log("EMAIL ERROR:", err);
   });

   res.send("updated");
  }
 );
});


// ================= EXPORT EXCEL =================
app.get("/export", async (req, res) => {

 try {

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Observations");

  sheet.columns = [
   { header: "Name", key: "name" },
   { header: "Department", key: "department" },
   { header: "Observation", key: "description" },
   { header: "Fix", key: "fix" },
   { header: "Status", key: "status" },
   { header: "Date", key: "date" }
  ];

  db.all("SELECT * FROM observations", async (err, rows) => {

   if (err) {
    console.log(err);
    return res.status(500).send("db error");
   }

   rows.forEach(r => sheet.addRow(r));

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
  });

 } catch (e) {
  console.log(e);
  res.status(500).send("export failed");
 }

});


// ================= WEEKLY OVERDUE EMAIL =================
cron.schedule("0 8 * * 1", () => {

 console.log("Checking overdue observations...");

 db.all(
  "SELECT * FROM observations WHERE status!='Closed'",
  (err, rows) => {

   if (err) return console.log(err);

   let overdueList = "";

   rows.forEach(o => {

    const today = new Date();
    const obsDate = new Date(o.date);
    const diff = (today - obsDate) / (1000 * 60 * 60 * 24);

    if (diff > 7) {

     overdueList +=
      "Name: " + o.name +
      "\nDept: " + o.department +
      "\nObservation: " + o.description +
      "\nDate: " + o.date + "\n\n";
    }
   });

   if (overdueList === "") return;

   transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nicholas.farrow@sms-group.com",
    subject: "Overdue Safety Observations",
    text: overdueList
   }, (err) => {
    if (err) console.log("EMAIL ERROR:", err);
   });

  }
 );

});


// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
 console.log("Server running on port", PORT);
});
