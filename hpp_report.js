// hpp_report.js — daftar AWB + status HPP (sudah/belum masuk biaya)
// Jalankan: mongosh "<MONGO_URL>" --quiet hpp_report.js > hpp_report.csv
// (ganti DB name di bawah bila perlu; default ambil dari argumen TARGET_DB env)

const DBNAME = (typeof process !== "undefined" && process.env && process.env.TARGET_DB) ? process.env.TARGET_DB : "tms_db";
const d = db.getSiblingDB(DBNAME);

const rows = d.awb_orders.aggregate([
  { $lookup: { from: "awb_costs", localField: "_id", foreignField: "awb_id", as: "costs" } },
  { $lookup: { from: "customers", localField: "customer_id", foreignField: "_id", as: "cust" } },
  { $project: {
      _id: 0,
      awb_number: 1,
      customer: { $ifNull: [ { $arrayElemAt: ["$cust.name", 0] }, "" ] },
      status: { $ifNull: ["$status", ""] },
      created_at: 1,
      nilai_jual: { $ifNull: ["$grand_total", { $ifNull: ["$total_tariff", 0] }] },
      cost_count: { $size: "$costs" },
      total_hpp: { $ifNull: [ { $sum: "$costs.amount" }, 0 ] },
      hpp_masuk: { $cond: [ { $gt: [ { $size: "$costs" }, 0 ] }, "YA", "BELUM" ] }
  } },
  { $sort: { hpp_masuk: 1, awb_number: 1 } }
], { allowDiskUse: true }).toArray();

function csv(v){ v = (v===null||v===undefined)?"":String(v); return '"' + v.replace(/"/g,'""') + '"'; }

print(["awb_number","customer","status","tgl_order","nilai_jual","cost_count","total_hpp","hpp_masuk"].join(","));
let sudah=0, belum=0, jualBelum=0;
rows.forEach(r => {
  const tgl = r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : "";
  if (r.hpp_masuk === "YA") sudah++; else { belum++; jualBelum += (r.nilai_jual||0); }
  print([csv(r.awb_number),csv(r.customer),csv(r.status),csv(tgl),r.nilai_jual||0,r.cost_count||0,r.total_hpp||0,csv(r.hpp_masuk)].join(","));
});
print("");
print("# RINGKASAN,,,,,,,");
print(`# Total AWB,${rows.length},,,,,,`);
print(`# HPP MASUK,${sudah},,,,,,`);
print(`# HPP BELUM,${belum},,,,Nilai jual AWB belum-HPP,${jualBelum},`);
