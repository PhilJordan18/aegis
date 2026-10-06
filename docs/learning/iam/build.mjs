import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "/Users/philippemonfouayi/Projects/aegis";
const DIR = path.join(ROOT, "docs/learning/iam");
const WORK = path.join(DIR, ".work");
const OUT = path.join(DIR, "output");
const FINAL = path.join(OUT, "aegis-spring-iam-v2.pptx");
const ART = path.join(ROOT, "docs/learning/assets/aegis-glass-cover.png");
const SKILL = "/Users/philippemonfouayi/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const PY = "/Users/philippemonfouayi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL,"container_tools/artifact_tool_utils.mjs")).href);
await fs.mkdir(WORK,{recursive:true}); await fs.mkdir(OUT,{recursive:true});

const p = Presentation.create({slideSize:{width:1280,height:720}});
const navy="#071025", panel="#101C37", panel2="#152748", white="#F8FBFF", muted="#B8C8E3", border="#30476F", blue="#5CA9FF", violet="#A28BFF", cyan="#67D9EA", green="#76E0BB", font="Avenir Next", mono="Menlo";
function rect(s,x,y,w,h,fill=panel,r=0,b=border){return s.shapes.add({geometry:r?"roundRect":"rect",position:{left:x,top:y,width:w,height:h},fill,line:{fill:b,width:b==="none"?0:1},...(r?{borderRadius:r}:{})});}
function text(s,t,x,y,w,h,z=22,c=white,b=false,f=font,a="left") {const o=s.shapes.add({geometry:"textbox",position:{left:x,top:y,width:w,height:h},fill:"none",line:{fill:"none",width:0}});o.text=t;o.text.style={typeface:f,fontSize:z,color:c,bold:b,alignment:a,autoFit:"none",wrap:"square",insets:{top:0,right:0,bottom:0,left:0}};return o;}
function rule(s,x,y,w,c=border){s.shapes.add({geometry:"line",position:{left:x,top:y,width:w,height:0},fill:"none",line:{fill:c,width:1}});}
function base(n,tag,title,sub=""){const s=p.slides.add();s.background.fill=navy;text(s,"AEGIS  /  LEARNING LAB",58,34,425,24,15,"#8198BA",true);text(s,String(n).padStart(2,"0"),1165,34,56,24,15,"#8198BA",true,font,"right");rule(s,58,68,1164);text(s,tag.toUpperCase(),58,91,1120,24,15,violet,true);text(s,title,58,125,1164,62,41,white,true);if(sub)text(s,sub,58,197,1164,49,21,muted);rule(s,58,673,1164);text(s,"Aegis · Spring IAM · 30 Sep 2026",58,687,570,20,12,"#7890B2");text(s,"IMPLEMENTED CODE / SOURCE-LINKED",792,687,429,20,12,"#7890B2",false,font,"right");return s;}
function card(s,x,y,w,h,heading,body,accent=blue){rect(s,x,y,w,h,panel,18);rect(s,x+22,y+22,5,36,accent,0,"none");text(s,heading,x+42,y+20,w-60,40,22,white,true);text(s,body,x+24,y+72,w-48,h-84,20,muted);}
function code(s,x,y,w,h,label,src,z=17){rect(s,x,y,w,h,"#0B1730",18);rect(s,x,y,w,45,panel2,18);text(s,label,x+22,y+11,w-44,25,14,cyan,true,mono);text(s,src,x+25,y+62,w-50,h-77,z,"#E4EEFF",false,mono);}
function notes(s,n){s.speakerNotes.textFrame.setText(n);}

{
 const s=p.slides.add(); s.background.fill=navy;s.images.add({blob:new Uint8Array(await fs.readFile(ART)),contentType:"image/png",alt:"Original Aegis optical glass art",fit:"cover",position:{left:0,top:0,width:1280,height:720}});
 text(s,"AEGIS  /  LEARNING LAB",72,58,610,30,17,"#D7E6FF",true);text(s,"The Spring IAM slice",72,222,725,85,57,white,true);text(s,"Trace sign-in, tokens, authorization, and tests\nthrough the code Aegis actually has.",76,415,680,104,24,"#D5E4FC");rule(s,76,594,575,"#84A9FF");text(s,"MODULE 02  ·  IMPLEMENTED BACKEND",76,614,665,27,16,"#BFD1EE",true);
 notes(s,"Original Aegis cover art generated for this course pack. Repository: services/api/README.md; services/api/src/main/java/ca/aegis/control/identity/.");
}
{
 const s=base(2,"Boundary","A real sign-in slice — no signup yet","The Web and iOS apps authenticate through the Spring API; the database is private.");
 card(s,58,281,356,248,"Implemented","POST /api/v1/auth/login\nGET /api/v1/auth/me\nJWT validation and live account lookup",cyan);
 card(s,461,281,356,248,"Not implemented","No public registration route\nNo refresh token\nNo Web/iOS auth client yet",violet);
 card(s,864,281,356,248,"Authority","Only Spring grants access. Neither a UI form nor an ESP32 can create a session or role.",green);
 text(s,"A registration screen is a product and trust decision, not a front-end-only feature.",58,568,1160,58,23,"#E4EEFF",true);
 notes(s,"Implemented routes: services/api/README.md:3-8,45-58; AuthController.java:15-38. No signup in current P0 scope: docs/cahier-conception/02-scope.md section 11.1; current user-requested registration is to be scoped separately. Aegis authority model: AGENTS.md and README.md.");
}
{
 const s=base(3,"Request path","What POST /auth/login does","The public route permits a request, but the service still verifies the credentials.");
 const xs=[58,294,530,766,1002], heads=["REQUEST","CONTROLLER","SERVICE","REPOSITORY","TOKEN"], bods=["JSON + client IP","Validate request","Limit + BCrypt + account status","Read aegis.users","Issue 60-min JWT"];
 for(let i=0;i<5;i++){rect(s,xs[i],290,218,228,i%2?panel2:panel,18);text(s,heads[i],xs[i]+16,313,186,35,19,i===2?violet:cyan,true);rule(s,xs[i]+16,358,185);text(s,bods[i],xs[i]+16,383,186,90,19,white);if(i<4)text(s,"→",xs[i]+219,376,18,39,24,blue,true,font,"center");}
 text(s,"Invalid credentials return one refusal path; no account existence is disclosed.",58,558,1160,63,23,"#E4EEFF",true);
 notes(s,"RequestIdFilter.java:18-44; SecurityConfiguration.java:54-77,94-101; AuthController.java:15-38; SensitiveRequestValidator.java:10-37; AuthenticationService.java:27-38; AccountRepository.java:12-37; AccessTokens.java:47-63. See Spring Security servlet architecture: https://docs.spring.io/spring-security/reference/7.0/servlet/architecture.html . Diagram is simplified; it does not imply all planned routes are implemented.");
}
{
 const s=base(4,"Business logic","The controller is thin; the service decides","Trace the actual login service instead of placing credential logic in HTTP code.");
 code(s,58,265,704,314,"AUTHENTICATIONSERVICE.JAVA · CONDENSED","attempts.acquire(clientAddress, request.email());\nvar candidate = accounts.findByEmail(request.email());\nboolean matches = passwordEncoder.matches(\n  request.password(),\n  candidate.map(Account::passwordHash)\n    .orElse(unknownAccountHash));\nvar account = candidate\n  .filter(a -> matches && a.canAuthenticate())\n  .orElseThrow(InvalidCredentialsException::new);",15);
 card(s,790,265,432,146,"Why a dummy hash?","An unknown address still goes through a password-hash check.",cyan);
 card(s,790,433,432,146,"Why check status?","A disabled account cannot authenticate even with a correct password.",violet);
 notes(s,"Condensed from services/api/src/main/java/ca/aegis/control/identity/AuthenticationService.java:27-38. The local attempt limiter, BCrypt encoder, account status and identical invalid-credentials path are implemented. Source excerpt uses 'matches' and 'a' as condensed local names; it is explanatory, not a byte-for-byte copy.");
}
{
 const s=base(5,"Protected request","GET /auth/me does not trust stale roles","The token establishes identity; the current database account remains the authorization source.");
 card(s,58,284,357,243,"1  Verify JWT","Check HS256 signature, issuer, audience, subject, ID, issue time, and expiry.",cyan);
 card(s,461,284,357,243,"2  Re-read account","Load the account by token subject; reject it if disabled or missing.",blue);
 card(s,864,284,357,243,"3  Apply current role","Build authentication from the database's current role and access level.",green);
 text(s,"A role claim records login-time state. It is not the final grant on later requests.",58,562,1160,67,24,"#E4EEFF",true);
 notes(s,"SecurityConfiguration.java:103-115; AccessTokens.java:47-115; CurrentAccountAuthenticationConverter.java:24-30; CurrentAccountAuthentication.java:8-16; AuthController.java:33-38. Official Spring Security architecture: https://docs.spring.io/spring-security/reference/7.0/servlet/architecture.html .");
}
{
 const s=base(6,"Security defaults","Stateless means explicit bearer tokens","Aegis disables browser-session flows and controls every documented route.");
 code(s,58,267,637,266,"SECURITYCONFIGURATION.JAVA · EXCERPT",".csrf(AbstractHttpConfigurer::disable)\n.sessionManagement(s -> s.sessionCreationPolicy(\n  SessionCreationPolicy.STATELESS))\n.httpBasic(AbstractHttpConfigurer::disable)\n.formLogin(AbstractHttpConfigurer::disable)",16);
 card(s,726,267,495,137,"Public routes","A stale bearer header is ignored on login and health routes.",cyan);
 card(s,726,425,495,137,"Protected routes","Require a valid token and a live, authorized account.",violet);
 text(s,"There is no refresh token in the current P0 IAM design.",58,574,1160,45,23,"#E4EEFF",true);
 notes(s,"Exact/condensed configuration from SecurityConfiguration.java:54-77,79-101. AccessTokens.java:23-36,47-63 states 60-minute HS256 token without refresh. HTTP route classification in ApiRoutes.java:39-84. Disabling CSRF is in this stateless explicit-bearer context, not a general Spring recommendation.");
}
{
 const s=base(7,"Evidence","Test behavior, not just compilation","The integration suite uses MockMvc and isolated real PostgreSQL.");
 card(s,58,270,357,276,"Login","Correct credentials work; wrong and unknown users get indistinguishable refusal; expired tokens fail.",cyan);
 card(s,461,270,357,276,"Authorization","A role or account-status change in the database affects already-issued tokens.",violet);
 card(s,864,270,357,276,"Schema","Flyway starts a fresh database and validates migration ordering.",green);
 text(s,"Read the test that proves each claim before you change that behavior.",58,574,1160,49,23,"#E4EEFF",true);
 notes(s,"AuthenticationApiTests.java:67-98,143-170,345-403; AuthorizationTests.java:146-186; FlywayMigrationTests.java:49-69; ApiIntegrationTest.java:31-68. services/api/README.md documents verified local test command.");
}
{
 const s=base(8,"Practice","Your IAM code tour","Follow one login and one /me request. Then answer these questions without looking.");
 const rows=[["01","AuthController.java","What does the controller delegate?"],["02","AuthenticationService.java","Where are credentials and status checked?"],["03","AccessTokens.java","What expires, and when?"],["04","CurrentAccountAuthenticationConverter.java","Why re-read the account?"]];
 rows.forEach((r,i)=>{const y=268+i*78;rect(s,58,y,1163,64,i%2?panel2:panel,12);text(s,r[0],80,y+16,48,30,20,violet,true,mono);text(s,r[1],150,y+17,550,30,20,white,true,mono);text(s,r[2],715,y+17,480,30,19,muted);});
 text(s,"Next decision: define who may create accounts before adding signup to the API.",58,601,1160,40,22,"#E4EEFF",true);
 notes(s,"All listed files exist in services/api/src/main/java/ca/aegis/control/identity/. The signup decision is a future scope/contract item explicitly requested by Philippe, not an implemented feature. Repository context: docs/cahier-conception/02-scope.md, docs/cahier-conception/09-contrats-rest.md.");
}

const draft=path.join(WORK,"candidate.pptx");await (await PresentationFile.exportPptx(p)).save(draft);
const res=await finalizePresentation({workspaceDir:DIR,candidatePath:draft,finalPath:FINAL,pythonExecutable:PY,integrityValidatorPath:path.join(SKILL,"container_tools/inspect_presentation_package_integrity.py"),layoutValidatorPath:path.join(SKILL,"container_tools/inspect_presentation_layout_geometry.py"),layoutArgs:["--expected-slide-size-emu","12192000,6858000","--validate-heading-fit"],requiredNativeTableOwnerSlides:[],fontPolicy:{basis:"design",families:[font,mono]},verifyArtifactToolImport:true,receiptPath:path.join(WORK,"aegis-spring-iam-v2.validation.json")});
console.log(JSON.stringify({final:FINAL,slides:res.packageIntegrity.slide_count,layoutFindings:res.presentationLayout.findingCount},null,2));
