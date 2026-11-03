import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { panelMode,validAdminSession } from "@/modules/auth";
import LoginForm from "./login-form";
import { clientLoginModeForProject,projectHostRole } from "@/modules/public-project";

export const dynamic="force-dynamic";

function loginError(code:string|undefined){
  if(code==="invalid")return "Login ID ya password galat hai.";
  if(code==="rate")return "Too many attempts. 15 minutes baad try karein.";
  if(code==="origin")return "Login request reject hua. Page reload karke dobara try karein.";
  return "";
}

export default async function LoginPage({searchParams}:{searchParams:Promise<{loginError?:string}>}){
  if(await validAdminSession())redirect("/admin");
  const mode=panelMode();
  let loginType:"email"|"mobile"|"mixed"=mode==="super"?"email":"mixed";
  let domainProjectId="";
  let domainProjectName="";
  if(mode==="client"){
    const host=(await headers()).get("host")||"";
    const hostRole=await projectHostRole(host);
    if(hostRole?.projectId && (hostRole.role==="public"||hostRole.role==="admin")){
      loginType=await clientLoginModeForProject(hostRole.projectId);
      domainProjectId=hostRole.projectId;
      const row=await env.DB.prepare(
        "SELECT name FROM projects WHERE id=? AND status='active' LIMIT 1",
      ).bind(domainProjectId).first<{name:string}>();
      domainProjectName=row?.name||"";
    }
  }
  const query=await searchParams;
  return <LoginForm mode={mode} loginType={loginType} projectId={domainProjectId} projectName={domainProjectName} initialError={loginError(query.loginError)}/>;
}
