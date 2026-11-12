import {notFound} from "next/navigation";
import {requireSuperAdmin,panelMode} from "@/modules/auth";
import MetroBlockMapper from "./metro-block-mapper";
export const dynamic="force-dynamic";
export default async function MetroBlockAdminPage(){
  if(panelMode()!=="super"||!await requireSuperAdmin())notFound();
  return <MetroBlockMapper/>;
}
