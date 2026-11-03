import { env } from "cloudflare:workers";
import { hashAdminPassword,requireSuperAdmin,sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { upsertPrimaryProjectDomain,upsertUnifiedProjectDomain,assertDomainAvailable,cleanHostInput,validHostname } from "@/modules/domains";
import { attachCustomerWorkerDomain } from "@/app/cloudflare-domain-provisioning";
import { FUTURE_INVEST_REALTY_ID } from "@/app/customer-direction-policy";
import { provisionClientAccess } from "@/modules/projects";
import { clientFallbackHost,clientLoginModeForProject } from "@/modules/projects";
import { currentProjectLinks } from "@/modules/projects";
import { validClientPassword } from "@/modules/auth";
import {
  internalEmailForMobile,
  normalizeClientLoginId,
  type ClientLoginType,
} from "@/modules/auth";

const unauthorized=()=>Response.json({error:"Super Admin access required"},{status:403});
const hostPattern=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
type UserRow={id:string;email:string;loginType:ClientLoginType;loginId:string|null;mobile:string|null;name:string;role:string;status:string;mustChangePassword:number;createdAt:string;updatedAt:string;lastLoginAt:string|null;projectId:string;projectName:string;projectSlug:string;publicHost:string|null;adminHost:string|null;projectAdminCount:number;projectActiveAdminCount:number};
type ProjectRow={id:string;name:string;slug:string;kind:string;publicHost:string|null;adminHost:string|null;status:string;deletedAt:string|null;adminCount:number;loginMode:string};
const cleanHost=(value:unknown)=>{const host=String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*/,"").replace(/\.$/,"");return host||null};
const validHost=(host:string|null)=>!host||hostPattern.test(host);
const slugify=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"project";
const clientAdminUrl=(slug="",adminHost?:string|null,publicHost?:string|null,projectId?:string)=>
  projectId===FUTURE_INVEST_REALTY_ID && adminHost && adminHost===publicHost
    ? `https://${adminHost}/admin`
    : slug?currentProjectLinks(slug,null,adminHost).adminUrl:`https://${clientFallbackHost()}/admin/login`;
const isGeoLab=async(projectId:string)=>Boolean(await env.DB.prepare("SELECT 1 FROM projects WHERE id=? AND kind='geo_lab' AND status!='deleted' LIMIT 1").bind(projectId).first());

export async function GET(request:Request){
  const actor=await requireSuperAdmin();if(!actor)return unauthorized();
  const url=new URL(request.url),section=String(url.searchParams.get("section")||"").trim();
  const readPage=(name:string,fallback:number,max:number)=>{const value=Number(url.searchParams.get(name));return Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):fallback};
  const projectQuery="SELECT p.id,p.name,p.slug,p.kind,p.public_host AS publicHost,p.admin_host AS adminHost,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount,COALESCE((SELECT s.value FROM settings s WHERE s.project_id=p.id AND s.key='clientLoginMode' LIMIT 1),'email') AS loginMode FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id WHERE p.status!='deleted' GROUP BY p.id ORDER BY p.created_at DESC";
  const archivedQuery="SELECT p.id,p.name,p.kind,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id WHERE p.status='deleted' GROUP BY p.id ORDER BY p.deleted_at DESC,p.updated_at DESC";
  const projectPageSelect="SELECT p.id,p.name,p.slug,p.kind,p.public_host AS publicHost,p.admin_host AS adminHost,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount,COALESCE((SELECT s.value FROM settings s WHERE s.project_id=p.id AND s.key='clientLoginMode' LIMIT 1),'email') AS loginMode FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id";

  if(section==="summary"){
    const [userCount,auditCount,projectCount,archivedCount]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM admin_users u JOIN projects p ON p.id=u.project_id WHERE p.status!='deleted'").first<{total:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs").first<{total:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM projects WHERE status!='deleted'").first<{total:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM projects WHERE status='deleted'").first<{total:number}>(),
    ]);
    return Response.json({
      userCount:Number(userCount?.total||0),
      auditCount:Number(auditCount?.total||0),
      projectCount:Number(projectCount?.total||0),
      archivedCount:Number(archivedCount?.total||0),
      clientAdminUrl:clientAdminUrl(),
    },{headers:{"cache-control":"no-store"}});
  }

  if(section==="project_options"){
    const limit=Math.max(1,readPage("limit",20,50));
    const q=String(url.searchParams.get("q")||"").trim().toLowerCase().slice(0,80);
    const pattern=`%${q.replace(/[%_]/g,"")}%`;
    const result=q
      ? await env.DB.prepare(
          "SELECT p.id,p.name,p.slug,p.kind,p.public_host AS publicHost,p.admin_host AS adminHost,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount,COALESCE((SELECT s.value FROM settings s WHERE s.project_id=p.id AND s.key='clientLoginMode' LIMIT 1),'email') AS loginMode FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id WHERE p.status!='deleted' AND (lower(p.name) LIKE ? OR lower(p.id) LIKE ? OR lower(p.slug) LIKE ?) GROUP BY p.id ORDER BY p.created_at DESC LIMIT ?",
        ).bind(pattern,pattern,pattern,limit).all<ProjectRow>()
      : await env.DB.prepare(
          "SELECT p.id,p.name,p.slug,p.kind,p.public_host AS publicHost,p.admin_host AS adminHost,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount,COALESCE((SELECT s.value FROM settings s WHERE s.project_id=p.id AND s.key='clientLoginMode' LIMIT 1),'email') AS loginMode FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id WHERE p.status!='deleted' GROUP BY p.id ORDER BY p.created_at DESC LIMIT ?",
        ).bind(limit).all<ProjectRow>();
    return Response.json({
      projects:result.results.map(project=>({...project,loginMode:project.loginMode==="mobile"?"mobile":"email"})),
    },{headers:{"cache-control":"no-store"}});
  }

  if(section==="archived"){
    const limit=Math.max(1,readPage("limit",10,50)),offset=readPage("offset",0,1_000_000);
    const [archived,total]=await Promise.all([
      env.DB.prepare("SELECT p.id,p.name,p.kind,p.status,p.deleted_at AS deletedAt,COUNT(u.id) AS adminCount FROM projects p LEFT JOIN admin_users u ON u.project_id=p.id WHERE p.status='deleted' GROUP BY p.id ORDER BY p.deleted_at DESC,p.updated_at DESC LIMIT ? OFFSET ?").bind(limit,offset).all(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM projects WHERE status='deleted'").first<{total:number}>(),
    ]);
    return Response.json({
      archivedProjects:archived.results,
      total:Number(total?.total||0),
      hasMore:offset+archived.results.length<Number(total?.total||0),
    },{headers:{"cache-control":"no-store"}});
  }

  if(section==="projects"){
    const limit=Math.max(1,readPage("limit",50,100)),offset=readPage("offset",0,1_000_000);
    const q=String(url.searchParams.get("q")||"").trim().toLowerCase().slice(0,120);
    const filter=q?" WHERE p.status!='deleted' AND (lower(p.name) LIKE ? OR lower(p.slug) LIKE ?)":" WHERE p.status!='deleted'";
    const group=" GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
    const countSql=q
      ?"SELECT COUNT(*) AS total FROM projects p WHERE p.status!='deleted' AND (lower(p.name) LIKE ? OR lower(p.slug) LIKE ?)"
      :"SELECT COUNT(*) AS total FROM projects p WHERE p.status!='deleted'";
    const like=`%${q}%`;
    const query=env.DB.prepare(projectPageSelect+filter+group);
    const count=env.DB.prepare(countSql);
    const [result,total]=q
      ? await Promise.all([
          query.bind(like,like,limit,offset).all<ProjectRow>(),
          count.bind(like,like).first<{total:number}>(),
        ])
      : await Promise.all([
          query.bind(limit,offset).all<ProjectRow>(),
          count.first<{total:number}>(),
        ]);
    return Response.json({
      projects:result.results.map(project=>({...project,loginMode:project.loginMode==="mobile"?"mobile":"email"})),
      total:Number(total?.total||0),
      nextOffset:offset+result.results.length,
      hasMore:offset+result.results.length<Number(total?.total||0),
    },{headers:{"cache-control":"no-store"}});
  }

  if(section==="clients"){
    const limit=Math.max(1,readPage("limit",8,50)),offset=readPage("offset",0,1_000_000);
    const [result,total]=await Promise.all([
      env.DB.prepare("SELECT u.id,u.email,u.login_type AS loginType,u.login_id AS loginId,u.mobile,u.name,u.role,u.status,u.must_change_password AS mustChangePassword,u.created_at AS createdAt,u.updated_at AS updatedAt,u.last_login_at AS lastLoginAt,p.id AS projectId,p.name AS projectName,p.slug AS projectSlug,p.public_host AS publicHost,p.admin_host AS adminHost,(SELECT COUNT(*) FROM admin_users ax WHERE ax.project_id=p.id) AS projectAdminCount,(SELECT COUNT(*) FROM admin_users aa WHERE aa.project_id=p.id AND aa.status='active') AS projectActiveAdminCount FROM admin_users u JOIN projects p ON p.id=u.project_id WHERE p.status!='deleted' ORDER BY u.created_at DESC LIMIT ? OFFSET ?").bind(limit,offset).all<UserRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM admin_users u JOIN projects p ON p.id=u.project_id WHERE p.status!='deleted'").first<{total:number}>(),
    ]);
    return Response.json({
      users:result.results.map(user=>({
        ...user,
        loginType:user.loginType==="mobile"?"mobile":"email",
        loginId:user.loginId||user.email,
        email:user.loginType==="mobile"?null:user.email,
        adminUrl:clientAdminUrl(user.projectSlug,user.adminHost,user.publicHost,user.projectId),
      })),
      total:Number(total?.total||0),
      nextOffset:offset+result.results.length,
      hasMore:offset+result.results.length<Number(total?.total||0),
      clientAdminUrl:clientAdminUrl(),
    },{headers:{"cache-control":"no-store"}});
  }

  if(section==="audits"){
    const limit=Math.max(1,readPage("limit",10,50)),offset=readPage("offset",0,1_000_000);
    const [audits,total]=await Promise.all([
      env.DB.prepare("SELECT action,actor_email AS actorEmail,project_id AS projectId,target_id AS targetId,created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit,offset).all(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs").first<{total:number}>(),
    ]);
    return Response.json({
      audits:audits.results,
      total:Number(total?.total||0),
      nextOffset:offset+audits.results.length,
      hasMore:offset+audits.results.length<Number(total?.total||0),
    },{headers:{"cache-control":"no-store"}});
  }

  const [result,projects,audits,archived]=await Promise.all([
    env.DB.prepare("SELECT u.id,u.email,u.login_type AS loginType,u.login_id AS loginId,u.mobile,u.name,u.role,u.status,u.must_change_password AS mustChangePassword,u.created_at AS createdAt,u.updated_at AS updatedAt,u.last_login_at AS lastLoginAt,p.id AS projectId,p.name AS projectName,p.slug AS projectSlug,p.public_host AS publicHost,p.admin_host AS adminHost,(SELECT COUNT(*) FROM admin_users ax WHERE ax.project_id=p.id) AS projectAdminCount,(SELECT COUNT(*) FROM admin_users aa WHERE aa.project_id=p.id AND aa.status='active') AS projectActiveAdminCount FROM admin_users u JOIN projects p ON p.id=u.project_id WHERE p.status!='deleted' ORDER BY u.created_at DESC").all<UserRow>(),
    env.DB.prepare(projectQuery).all<ProjectRow>(),
    env.DB.prepare("SELECT action,actor_email AS actorEmail,project_id AS projectId,target_id AS targetId,created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT 50").all(),
    env.DB.prepare(archivedQuery).all()
  ]);
  return Response.json({
    users:result.results.map(user=>({
      ...user,
      loginType:user.loginType==="mobile"?"mobile":"email",
      loginId:user.loginId||user.email,
      email:user.loginType==="mobile"?null:user.email,
      adminUrl:clientAdminUrl(user.projectSlug,user.adminHost,user.publicHost,user.projectId),
    })),
    projects:projects.results.map(project=>({...project,loginMode:project.loginMode==="mobile"?"mobile":"email"})),
    archivedProjects:archived.results,
    audits:audits.results,
    clientAdminUrl:clientAdminUrl()
  },{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const actor=await requireSuperAdmin();if(!actor)return unauthorized();if(!sameOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
  const body=await request.json().catch(()=>({})) as {action?:string;loginId?:string;email?:string;name?:string;password?:string;projectId?:string;projectName?:string;publicHost?:string;adminHost?:string};
  if(body.action==="connect_existing_domain"){
    const projectId=String(body.projectId||"").trim();
    if(projectId!==FUTURE_INVEST_REALTY_ID)
      return Response.json({error:"This unified domain setup is scoped to Future Invest Realty only"},{status:403});
    const host=cleanHostInput(body.publicHost);
    if(!host||!validHostname(host)||String(body.publicHost||"").trim().includes("/"))
      return Response.json({error:"Enter a hostname only, e.g. www.customer.com (no path or https://)"},{status:400});
    const project=await env.DB.prepare(
      "SELECT id,name,slug,public_status AS publicStatus FROM projects WHERE id=? AND status='active' LIMIT 1",
    ).bind(projectId).first<{id:string;name:string;slug:string;publicStatus:string}>();
    if(!project)return Response.json({error:"Existing active project not found"},{status:404});
    if(project.publicStatus!=="published")
      return Response.json({error:"Publish the project before connecting a customer domain"},{status:409});
    const admin=await env.DB.prepare(
      "SELECT id FROM admin_users WHERE project_id=? AND role='client_admin' AND status='active' LIMIT 1",
    ).bind(projectId).first();
    if(!admin)return Response.json({error:"Existing active client admin missing; restore client access first"},{status:409});
    try {
      await assertDomainAvailable(host,projectId);
      const cloudflare=await attachCustomerWorkerDomain(host);
      await upsertUnifiedProjectDomain(projectId,host);
      await writeAudit(actor,"project.unified_domain_connected",projectId,null,{host,cloudflare:cloudflare.state,reusedExistingAdmin:true});
      return Response.json({
        ok:true,projectId,projectName:project.name,host,
        publicUrl:`https://${host}/`,adminUrl:`https://${host}/admin`,
        existingAdminReused:true,cloudflareStatus:cloudflare.state,message:cloudflare.message,
      });
    } catch(error) {
      return Response.json({error:error instanceof Error?error.message:"Domain connection failed"},{status:409});
    }
  }
  const name=String(body.name||"").trim(),password=String(body.password||""),projectName=String(body.projectName||"").trim(),publicHost=cleanHost(body.publicHost),adminHost=cleanHost(body.adminHost);
  if(name.length<2||name.length>80||!validClientPassword(password)||!validHost(publicHost)||!validHost(adminHost))return Response.json({error:"Valid details aur 8+ character password with letter + number required"},{status:400});

  let projectId=String(body.projectId||"").trim(),resolvedName=projectName,resolvedSlug="",loginType:ClientLoginType="mobile";
  if(projectId){
    const project=await env.DB.prepare("SELECT id,name,slug,status FROM projects WHERE id=? AND status!='deleted' LIMIT 1").bind(projectId).first<{id:string;name:string;slug:string;status:string}>();
    if(!project)return Response.json({error:"Existing project nahi mila"},{status:404});
    resolvedName=project.name;resolvedSlug=project.slug;loginType=await clientLoginModeForProject(projectId);
  }else{
    if(projectName.length<2||projectName.length>100)return Response.json({error:"Project name required"},{status:400});
    projectId=crypto.randomUUID();
    loginType="mobile";
  }

  const loginId=normalizeClientLoginId(loginType,body.loginId??body.email);
  if(!loginId)return Response.json({error:loginType==="mobile"?"Valid mobile number required — 10 digit India number ya +country code use karein":"Valid client email required"},{status:400});
  if(loginType==="email"&&loginId===(env as unknown as Record<string,string>).ADMIN_EMAIL?.toLowerCase())return Response.json({error:"Owner email client account me use nahi ho sakta"},{status:409});
  const duplicate=await env.DB.prepare("SELECT id FROM admin_users WHERE login_id=? OR ((login_type='email' OR login_type IS NULL) AND lower(email)=?) LIMIT 1").bind(loginId,loginId).first();
  if(duplicate)return Response.json({error:"Is login ID ka account pehle se hai"},{status:409});

  const id=crypto.randomUUID(),email=loginType==="email"?loginId:internalEmailForMobile(id),mobile=loginType==="mobile"?loginId:null,now=new Date().toISOString(),hash=await hashAdminPassword(password),slug=resolvedSlug||`${slugify(resolvedName)}-${projectId.slice(0,6)}`;
  try{
    await provisionClientAccess({
      createProject: !body.projectId,
      projectId,
      projectName: resolvedName,
      projectSlug: slug,
      adminId: id,
      email,
      loginType,
      loginId,
      mobile,
      name,
      password: hash,
      actor,
      auditDetails: {loginType,loginId,projectName: resolvedName,publicHost,adminHost},
      publicHost,
      adminHost,
      now,
    });
  }catch(error){
    console.error("Client project create failed",error);
    return Response.json({error:"Login ID, project slug ya domain pehle se use ho raha hai"},{status:409});
  }
  return Response.json({user:{id,email:loginType==="email"?email:null,loginType,loginId,mobile,name,projectId,projectName:resolvedName,projectSlug:slug,publicHost,adminHost,role:"client_admin",status:"active",mustChangePassword:true,createdAt:now,updatedAt:now,lastLoginAt:null,adminUrl:clientAdminUrl(slug,adminHost)},clientAdminUrl:clientAdminUrl(slug,adminHost)},{status:201});
}

async function restoreArchivedProject(projectId:string,now:string){
  const snapshot=await env.DB.prepare("SELECT COUNT(*) AS total FROM project_archive_access_snapshot WHERE project_id=?").bind(projectId).first<{total:number}>();
  const hasSnapshot=Number(snapshot?.total||0)>0;
  if(!hasSnapshot){
    await env.DB.prepare("UPDATE projects SET status='active',deleted_at=NULL,updated_at=? WHERE id=?").bind(now,projectId).run();
    return {accessRestored:false};
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE projects SET status='active',deleted_at=NULL,public_host=(SELECT public_host FROM project_archive_access_snapshot WHERE project_id=? AND entity_type='project' LIMIT 1),admin_host=(SELECT admin_host FROM project_archive_access_snapshot WHERE project_id=? AND entity_type='project' LIMIT 1),updated_at=? WHERE id=?").bind(projectId,projectId,now,projectId),
    env.DB.prepare("UPDATE admin_users SET status=COALESCE((SELECT s.status FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='admin' AND s.entity_id=admin_users.id),status),session_version=session_version+1,updated_at=? WHERE project_id=?").bind(projectId,now,projectId),
    env.DB.prepare("UPDATE project_memberships SET status=COALESCE((SELECT s.status FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='membership' AND s.entity_id=project_memberships.user_id),status),is_primary=COALESCE((SELECT s.is_primary FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='membership' AND s.entity_id=project_memberships.user_id),is_primary),updated_at=? WHERE project_id=?").bind(projectId,projectId,now,projectId),
    env.DB.prepare("UPDATE project_domains SET status=COALESCE((SELECT s.status FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='domain' AND s.entity_id=project_domains.host),status),public_primary=COALESCE((SELECT s.public_primary FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='domain' AND s.entity_id=project_domains.host),public_primary),admin_primary=COALESCE((SELECT s.admin_primary FROM project_archive_access_snapshot s WHERE s.project_id=? AND s.entity_type='domain' AND s.entity_id=project_domains.host),admin_primary),updated_at=? WHERE project_id=?").bind(projectId,projectId,projectId,now,projectId),
    env.DB.prepare("DELETE FROM project_archive_access_snapshot WHERE project_id=?").bind(projectId),
  ]);
  return {accessRestored:true};
}

function archiveAccessSnapshotStatements(projectId:string,archivedAt:string){
  return [
    env.DB.prepare("DELETE FROM project_archive_access_snapshot WHERE project_id=?").bind(projectId),
    env.DB.prepare("INSERT INTO project_archive_access_snapshot (project_id,entity_type,entity_id,status,public_host,admin_host,archived_at) SELECT id,'project',id,status,public_host,admin_host,? FROM projects WHERE id=?").bind(archivedAt,projectId),
    env.DB.prepare("INSERT INTO project_archive_access_snapshot (project_id,entity_type,entity_id,status,archived_at) SELECT project_id,'admin',id,status,? FROM admin_users WHERE project_id=?").bind(archivedAt,projectId),
    env.DB.prepare("INSERT INTO project_archive_access_snapshot (project_id,entity_type,entity_id,status,is_primary,archived_at) SELECT project_id,'membership',user_id,status,is_primary,? FROM project_memberships WHERE project_id=?").bind(archivedAt,projectId),
    env.DB.prepare("INSERT INTO project_archive_access_snapshot (project_id,entity_type,entity_id,status,public_primary,admin_primary,archived_at) SELECT project_id,'domain',host,status,public_primary,admin_primary,? FROM project_domains WHERE project_id=?").bind(archivedAt,projectId),
  ];
}

export async function PATCH(request:Request){
  const actor=await requireSuperAdmin();if(!actor)return unauthorized();if(!sameOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
  const body=await request.json().catch(()=>({})) as {id?:string;projectId?:string;action?:string;name?:string;password?:string;publicHost?:string;adminHost?:string},id=String(body.id||""),action=String(body.action||""),now=new Date().toISOString();
  if(action==="restore_project"){
    const projectId=String(body.projectId||"").trim();
    if(!projectId)return Response.json({error:"Project required"},{status:400});
    const project=await env.DB.prepare("SELECT id,name FROM projects WHERE id=? AND status='deleted' LIMIT 1").bind(projectId).first<{id:string;name:string}>();
    if(!project)return Response.json({error:"Archived project nahi mila"},{status:404});
    try{
      const restored=await restoreArchivedProject(projectId,now);
      await writeAudit(actor,"client.project_restored",projectId,null,restored);
      return Response.json({ok:true,accessRestored:restored.accessRestored,project:{id:project.id,name:project.name,status:"active"}});
    }catch(error){
      console.error("Project restore failed",error);
      return Response.json({error:"Project restore nahi hua. Purana domain kisi aur project me use ho raha ho sakta hai."},{status:409});
    }
  }
  const current=await env.DB.prepare("SELECT id,status,project_id AS projectId FROM admin_users WHERE id=? LIMIT 1").bind(id).first<{id:string;status:string;projectId:string}>();if(!current)return Response.json({error:"Client admin nahi mila"},{status:404});
  if(action==="toggle"){const status=current.status==="active"?"disabled":"active";await env.DB.batch([env.DB.prepare("UPDATE admin_users SET status=?,session_version=session_version+1,updated_at=? WHERE id=?").bind(status,now,id),env.DB.prepare("UPDATE project_memberships SET status=?,updated_at=? WHERE user_id=? AND project_id=?").bind(status,now,id,current.projectId)]);await writeAudit(actor,`client.${status}`,current.projectId,id);return Response.json({ok:true,status})}
  if(action==="domains"){if(await isGeoLab(current.projectId))return Response.json({error:"Geo Lab project par domain attach disabled hai"},{status:409});const publicHost=cleanHost(body.publicHost),adminHost=cleanHost(body.adminHost);if(!validHost(publicHost)||!validHost(adminHost))return Response.json({error:"Valid domain लिखें, https:// या path नहीं"},{status:400});try{await upsertPrimaryProjectDomain(current.projectId,"public",publicHost,now);await upsertPrimaryProjectDomain(current.projectId,"admin",adminHost,now)}catch{return Response.json({error:"Domain kisi aur project me use ho raha hai"},{status:409})}await writeAudit(actor,"project.domains_updated",current.projectId,id,{publicHost,adminHost});return Response.json({ok:true,publicHost,adminHost})}
  if(action==="rename"){const name=String(body.name||"").trim();if(name.length<2||name.length>80)return Response.json({error:"Valid name required"},{status:400});await env.DB.prepare("UPDATE admin_users SET name=?,updated_at=? WHERE id=?").bind(name,now,id).run();await writeAudit(actor,"client.renamed",current.projectId,id);return Response.json({ok:true,name})}
  if(action==="reset_password"){const password=String(body.password||"");if(!validClientPassword(password))return Response.json({error:"Password kam se kam 8 characters ka ho; letter + number zaroori hain, special optional hai"},{status:400});const hash=await hashAdminPassword(password);await env.DB.prepare("UPDATE admin_users SET password_hash=?,password_salt=?,must_change_password=1,session_version=session_version+1,updated_at=? WHERE id=?").bind(hash.passwordHash,hash.passwordSalt,now,id).run();await writeAudit(actor,"client.password_reset",current.projectId,id);return Response.json({ok:true})}
  return Response.json({error:"Invalid action"},{status:400});
}

export async function DELETE(request:Request){
  const actor=await requireSuperAdmin();if(!actor)return unauthorized();if(!sameOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
  const id=new URL(request.url).searchParams.get("id");if(!id)return Response.json({error:"Missing id"},{status:400});
  const current=await env.DB.prepare("SELECT u.project_id AS projectId,p.name AS projectName,p.kind AS projectKind FROM admin_users u JOIN projects p ON p.id=u.project_id WHERE u.id=?").bind(id).first<{projectId:string;projectName:string;projectKind:string}>();if(!current)return Response.json({error:"Client admin nahi mila"},{status:404});
  // Never leave an active project without an active admin. Disabled admins do
  // not count as usable access for this decision.
  const otherActive=await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM admin_users WHERE project_id=? AND id<>? AND status='active'",
  ).bind(current.projectId,id).first<{total:number}>();
  if(Number(otherActive?.total||0)>0){await env.DB.batch([env.DB.prepare("DELETE FROM project_memberships WHERE user_id=? AND project_id=?").bind(id,current.projectId),env.DB.prepare("DELETE FROM admin_users WHERE id=?").bind(id)]);await writeAudit(actor,"client.admin_removed",current.projectId,id);return Response.json({ok:true,projectDeleted:false})}
  const deletedAt=new Date().toISOString();
  await env.DB.batch([
    ...archiveAccessSnapshotStatements(current.projectId,deletedAt),
    env.DB.prepare("UPDATE projects SET status='deleted',deleted_at=?,public_status='draft',public_host=NULL,admin_host=NULL,updated_at=? WHERE id=?").bind(deletedAt,deletedAt,current.projectId),
    env.DB.prepare("UPDATE admin_users SET status='disabled',session_version=session_version+1,updated_at=? WHERE project_id=?").bind(deletedAt,current.projectId),
    env.DB.prepare("UPDATE project_memberships SET status='disabled',updated_at=? WHERE project_id=?").bind(deletedAt,current.projectId),
    env.DB.prepare("UPDATE project_domains SET status='disabled',public_primary=0,admin_primary=0,updated_at=? WHERE project_id=?").bind(deletedAt,current.projectId)
  ]);
  await writeAudit(actor,"client.project_archived",current.projectId,id,{recoverable:true});
  return Response.json({ok:true,projectDeleted:true,recoverable:true,deletedProject:{id:current.projectId,name:current.projectName,deletedAt}});
}
