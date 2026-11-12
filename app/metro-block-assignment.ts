/**
 * METRO CITY: strictly draft-only inventory → block assignment.
 * A plot number that doesn't unambiguously identify A/B/C must be reviewed.
 * This module NEVER decides status, dimensions, pricing, or geometry.
 */
export type MetroAssignmentBlock = "a" | "b" | "c";
export type MetroAssignment = {plotId:string;block:MetroAssignmentBlock};
export type MetroAssignmentPreview = {
  total:number;
  autoAssigned:number;
  counts:Record<MetroAssignmentBlock,number>;
  unknown:string[];
};
export function suggestedMetroBlock(id:string):MetroAssignmentBlock|null{
  const cleaned=String(id).trim();
  if (/^B[-_\s]?\d+$/i.test(cleaned))return "b";
  if (/^C[-_\s]?\d+$/i.test(cleaned))return "c";
  if (/^(?:A[-_\s]?)?\d+$/i.test(cleaned))return "a";
  return null;
}
export function previewMetroAssignments(plots:ReadonlyArray<{id:string}>):MetroAssignmentPreview{
  const counts={a:0,b:0,c:0};
  const unknown:string[]=[];
  for(const plot of plots){
    const guess=suggestedMetroBlock(plot.id);
    if(guess)counts[guess]++;
    else unknown.push(plot.id);
  }
  return {total:plots.length,autoAssigned:plots.length-unknown.length,counts,unknown};
}
export function completeMetroAssignments(
  plots:ReadonlyArray<{id:string}>,
  explicit:unknown,
):{ok:true;assignments:MetroAssignment[];counts:Record<MetroAssignmentBlock,number>}|{ok:false;error:string;unknown:string[]}{
  const preview=previewMetroAssignments(plots);
  if(!Array.isArray(explicit)||explicit.length>plots.length){
    return {ok:false,error:"Provide explicit block assignments for all unrecognized plots",unknown:preview.unknown};
  }
  const override=new Map<string,MetroAssignmentBlock>();
  const expected=new Set(preview.unknown);
  for(const raw of explicit){
    if(!raw||typeof raw!=="object")return {ok:false,error:"Invalid block assignment",unknown:preview.unknown};
    const item=raw as Record<string,unknown>;
    if(typeof item.plotId!=="string"||!expected.has(item.plotId)||override.has(item.plotId)||
      (item.block!=="a"&&item.block!=="b"&&item.block!=="c")){
      return {ok:false,error:"Assignments must use each unrecognized Plot ID exactly once and a valid Block",unknown:preview.unknown};
    }
    override.set(item.plotId,item.block);
  }
  if(override.size!==preview.unknown.length)
    return {ok:false,error:"Some plots need explicit block assignment",unknown:preview.unknown.filter(id=>!override.has(id))};
  const counts={a:0,b:0,c:0};
  const assignments:MetroAssignment[]=[];
  const seen=new Set<string>();
  for(const plot of plots){
    if(seen.has(plot.id))return {ok:false,error:"Duplicate canonical plot ID",unknown:[plot.id]};
    seen.add(plot.id);
    const block=suggestedMetroBlock(plot.id)||override.get(plot.id);
    if(!block)return {ok:false,error:"Plot assignment incomplete",unknown:[plot.id]};
    assignments.push({plotId:plot.id,block});
    counts[block]++;
  }
  return {ok:true,assignments,counts};
}
