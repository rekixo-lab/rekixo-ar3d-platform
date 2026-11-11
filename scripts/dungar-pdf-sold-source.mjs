// Source: Dungar_Residency_Block.pdf (6 pages), inspected 2026-11-11.
// Page SOLD rows: 39, 43, 37, 31, 12, 1 = 163 (161 SOLD + 2 VILA SOLD).
// This is a status-only inventory reference: no areas, shapes, or financial data.
export const projectSlug="hree-dungar-residency-9176ee";
export const projectName="SHREE DUNGAR RESIDENCY";
const range=(lo,hi,prefix="",pad=0)=>Array.from({length:hi-lo+1},(_,k)=>prefix+String(lo+k).padStart(pad,"0"));

const splitA=["22A","22B","43A","43B","62A","62B","86A","86B"];
export const allPdfIds=[
  ...range(1,9,"",2),...range(10,131),...splitA,
  ...range(1,18,"B-"),
  "B-19 & B-20 B-21","B-22 & B-23-24",
  ...range(25,35,"B-"),...range(1,87,"C-")
];

export const soldPdfIds=[
  ...range(2,8,"",2),...range(10,22),...range(24,62),...range(64,86),
  ...range(88,112),...range(115,118),...range(124,126),...splitA,
  ...range(1,6,"B-"),...range(9,18,"B-"),
  "B-19 & B-20 B-21","B-22 & B-23-24","B-26",...range(28,35,"B-"),
  "C-1",...range(6,9,"C-"),...range(23,29,"C-"),"C-36","C-86"
];

export const pdfPageSoldCounts=[39,43,37,31,12,1];
export const villaSoldIds=["125","126"];
export const expectedTotal=257,expectedSold=163,expectedUnmarked=94;

export function validatePdfReference(){
  const all=new Set(allPdfIds),sold=new Set(soldPdfIds);
  if(all.size!==expectedTotal||sold.size!==expectedSold||allPdfIds.length!==expectedTotal||
    soldPdfIds.length!==expectedSold)throw Error("PDF reference counts changed");
  if(soldPdfIds.some(id=>!all.has(id)))throw Error("SOLD list contains missing plot ID");
  if(villaSoldIds.some(id=>!sold.has(id)))throw Error("VILA SOLD not included");
  return {all,sold};
}
