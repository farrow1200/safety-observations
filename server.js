const ExcelJS = require("exceljs");
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const { Resend } = require("resend");
console.log("RESEND KEY EXISTS:", !!process.env.RESEND_API_KEY);
console.log("RESEND KEY CHECK:", process.env.RESEND_API_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);


const app = express();

app.use(bodyParser.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./safety.db");

// ================= EMAIL =================
console.log("RESEND KEY CHECK:", process.env.RESEND_API_KEY);

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
  async function (err) {

   if (err) return res.status(500).send("db error");

   try{
    await resend.emails.send({
     from:"onboarding@resend.dev",
     to:["nicholas.farrow@sms-group.com"],
     subject:"New Safety Observation",
     text:
      "Employee: "+obs.name+
      "\nDept: "+obs.department+
      "\nObservation: "+obs.description+
      "\nStatus: "+obs.status
    });
   }catch(e){
    console.log("EMAIL ERROR:",e.message);
   }

   res.send("ok");
  }
 );
});

// ================= GET DATA =================
app.get("/data",(req,res)=>{
 db.all("SELECT * FROM observations",(err,rows)=>{
  if(err) return res.status(500).send("db error");
  res.json(rows);
 });
});

// ================= UPDATE OBS =================
app.put("/update/:id",(req,res)=>{

 const id=req.params.id;

 db.run(
  `UPDATE observations SET status=?,fix=? WHERE id=?`,
  [req.body.status,req.body.fix,id],
  async (err)=>{

   if(err) return res.status(500).send("update error");

   try{
    await resend.emails.send({
     from:"onboarding@resend.dev",
     to:["nicholas.farrow@sms-group.com"],
     subject:"Observation Closed",
     text:"Observation "+id+" was closed."
    });
   }catch(e){
    console.log("EMAIL ERROR:",e.message);
   }

   res.send("updated");
  }
 );
});

// ================= EXPORT EXCEL =================
app.get("/export", async (req,res)=>{

 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet("Observations");

 sheet.columns=[
  {header:"Name",key:"name"},
  {header:"Department",key:"department"},
  {header:"Observation",key:"description"},
  {header:"Fix",key:"fix"},
  {header:"Status",key:"status"},
  {header:"Date",key:"date"}
 ];

 db.all("SELECT * FROM observations", async(err,rows)=>{

  if(err) return res.status(500).send("db error");

  rows.forEach(r=>sheet.addRow(r));

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
});

// ================= WEEKLY OVERDUE EMAIL =================
cron.schedule("0 8 * * 1",()=>{

 db.all(
  "SELECT * FROM observations WHERE status!='Closed'",
  async (err,rows)=>{

   if(err) return;

   let overdueList="";

   rows.forEach(o=>{
    const today=new Date();
    const obsDate=new Date(o.date);
    const diff=(today-obsDate)/(1000*60*60*24);

    if(diff>7){
     overdueList+=
      "Name: "+o.name+
      "\nDept: "+o.department+
      "\nObservation: "+o.description+
      "\nDate: "+o.date+"\n\n";
    }
   });

   if(overdueList==="") return;

   try{
    await resend.emails.send({
     from:"onboarding@resend.dev",
     to:["nicholas.farrow@sms-group.com"],
     subject:"Overdue Safety Observations",
     text:overdueList
    });
   }catch(e){
    console.log("EMAIL ERROR:",e.message);
   }

  }
 );
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
 console.log("Server running on port",PORT);
});
