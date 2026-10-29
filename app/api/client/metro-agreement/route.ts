import {sameOrigin,validAdminSession} from "@/modules/auth";
import {metroAgreementEnabled} from "@/app/metro-agreement";

// Deprecated: this endpoint could set Agreement Done on a Booked/Available
// plot without a Sale, creating contradictory public and financial statuses.
// Do not remove existing plot values: only block new writes through this route.
// The unified Metro selector uses /api/client/metro-status with one D1 batch.
export async function PATCH(request:Request){
  if(!sameOrigin(request))return Response.json({error:"Invalid origin"},{status:403});
  const session=await validAdminSession();
  if(!session||session.role!=="client_admin")return Response.json({error:"Client Admin required"},{status:401});
  if(!await metroAgreementEnabled(session.projectId))return Response.json({error:"Not enabled"},{status:403});
  return Response.json({error:"Use the unified Plot Management Status dropdown. Refresh the page.",
    code:"METRO_AGREEMENT_LEGACY_WRITE_DISABLED"},{status:409,headers:{"cache-control":"private, no-store"}});
}
