const ExcelJS = require("exceljs");
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const nodemailer=require("nodemailer");
const cron=require("node-cron");

const app = express();

app.use(bodyParser.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./safety.db");

// EMAIL SETUP
const transporter = nodemailer.createTransport({
 host: "smtp.gmail.com",
 port: 465,
 secure: true,
 auth: {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS
 }
});


// CREATE TABLE
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

// ADD OBSERVATION
app.post("/add",(req,res)=>{

 const obs=req.body;
 const date=new Date().toISOString().split("T")[0];

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
  (err)=>{

   if(err){
    console.log(err);
    return res.status(500).send("error");
   }

   transporter.sendMail({
    from:"n05669169@gmail.com",
    to:"nicholas.farrow@sms-group.com",
    subject:"New Safety Observation",
    text:
     "Employee: "+obs.name+
     "\nDept: "+obs.department+
     "\nObservation: "+obs.description+
     "\nStatus: "+obs.status
   });

   res.send("ok");
  }
 );

});

// GET DATA
app.get("/data",(req,res)=>{
 db.all("SELECT * FROM observations",(err,rows)=>{
  res.json(rows);
 });
});

// UPDATE OBSERVATION
app.put("/update/:id",(req,res)=>{

 const id=req.params.id;

 db.run(
  `UPDATE observations SET status=?,fix=? WHERE id=?`,
  [req.body.status,req.body.fix,id],
  ()=>{

   transporter.sendMail({
    from:"n05669169@gmail.com",
    to:"nicholas.farrow@sms-group.com",
    subject:"Observation Closed",
    text:"Observation "+id+" was closed."
   });

   res.send("updated");
  }
 );

});

// EXPORT EXCEL
app.get("/export", async (req,res)=>{

 try{

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

  db.all("SELECT * FROM observations", async (err,rows)=>{

   if(err){
    console.log(err);
    return res.status(500).send("db error");
   }

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

 }catch(e){
  console.log(e);
  res.status(500).send("export failed");
 }

});




app.listen(3000,()=>{
 console.log("Server running on http://localhost:3000");
});
