import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "/Users/philippemonfouayi/Projects/aegis";
const SKILL_DIR = "/Users/philippemonfouayi/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const WORKSPACE = path.join(ROOT, "docs/learning/spring-foundations");
const WORK = path.join(WORKSPACE, ".work");
const OUTPUT = path.join(WORKSPACE, "output");
const FINAL_PPTX = path.join(OUTPUT, "aegis-spring-foundations-v3.pptx");
const PYTHON = "/Users/philippemonfouayi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const ART = path.join(ROOT, "docs/learning/assets/aegis-glass-cover.png");
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);

await fs.mkdir(WORK, { recursive: true });
await fs.mkdir(OUTPUT, { recursive: true });

const P = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const C = {
  navy: "#071025", panel: "#101C37", panel2: "#142545", panel3: "#182C52",
  white: "#F8FBFF", muted: "#B6C6DF", faint: "#7890B2", blue: "#5CA9FF",
  violet: "#A28BFF", cyan: "#67D9EA", green: "#76E0BB", border: "#2F456B",
  bright: "#DDEBFF", darkText: "#09152A", lightBg: "#EFF5FF", lightPanel: "#FFFFFF",
};
const FONT = "Avenir Next";
const CODE = "Menlo";

function shape(slide, x, y, w, h, fill, border = "none", radius = 0) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect", position: { left:x, top:y, width:w, height:h },
    fill, line: { fill:border, width:border === "none" ? 0 : 1 },
    ...(radius ? { borderRadius:radius } : {}),
  });
}
function txt(slide, value, x, y, w, h, size, color=C.white, weight=false, opts={}) {
  const s = slide.shapes.add({ geometry:"textbox", position:{left:x,top:y,width:w,height:h}, fill:"none", line:{fill:"none",width:0} });
  s.text = value;
  s.text.style = { typeface:opts.font ?? FONT, fontSize:size, bold:weight, color,
    alignment:opts.align ?? "left", verticalAlignment:opts.valign ?? "top", autoFit:"none",
    wrap:opts.wrap ?? "square", lineSpacing:opts.lineSpacing ?? 1.04,
    insets:{top:0,right:0,bottom:0,left:0} };
  return s;
}
function line(slide, x, y, w, fill=C.border, weight=1) {
  return slide.shapes.add({ geometry:"line", position:{left:x,top:y,width:w,height:0}, fill:"none", line:{fill,width:weight} });
}
function base(n, section, title, subtitle="", light=false) {
  const s=P.slides.add(); s.background.fill=light?C.lightBg:C.navy;
  txt(s, "AEGIS  /  LEARNING LAB", 58, 33, 430, 25, 15, light?"#49628A":C.faint, true);
  txt(s, String(n).padStart(2,"0"), 1160, 31, 62, 28, 16, light?"#49628A":C.faint, true, {align:"right"});
  line(s, 58, 67, 1164, light?"#C8D8EE":C.border);
  txt(s, section.toUpperCase(), 58, 91, 1148, 22, 15, light?"#5356BD":C.violet, true);
  txt(s, title, 58, 125, 1148, 61, 42, light?C.darkText:C.white, true);
  if(subtitle) txt(s, subtitle, 58, 190, 1148, 41, 21, light?"#47607E":C.muted);
  line(s,58,673,1164,light?"#C8D8EE":C.border);
  txt(s,"Aegis · Spring foundations · 30 Sep 2026",58,687,590,20,12,light?"#587293":C.faint);
  txt(s,"EDUCATIONAL / SOURCE-LINKED",827,687,395,20,12,light?"#587293":C.faint,false,{align:"right"});
  return s;
}
function card(slide, x,y,w,h, label, body, accent=C.blue, light=false) {
  shape(slide,x,y,w,h,light?C.lightPanel:C.panel,light?"#D1DEF0":C.border,18);
  shape(slide,x+23,y+22,5,36,accent);
  txt(slide,label,x+42,y+21,w-65,30,22,light?C.darkText:C.white,true);
  txt(slide,body,x+23,y+68,w-46,h-90,19,light?"#385173":C.muted,false,{lineSpacing:1.15});
}
function codePanel(slide, x,y,w,h, code, label="SOURCE EXCERPT", fontSize=18) {
  shape(slide,x,y,w,h,"#0C1730",C.border,18);
  shape(slide,x,y,w,44,"#152748",C.border,18);
  txt(slide,label,x+22,y+10,w-44,24,14,C.cyan,true,{font:CODE});
  txt(slide,code,x+25,y+62,w-50,h-79,fontSize,"#DFEAFF",false,{font:CODE,lineSpacing:1.08});
}
function cite(slide, text) { slide.speakerNotes.textFrame.setText(text); }

// 1 — cover. The raster is original presentation art, not a screenshot.
{
  const s=P.slides.add(); s.background.fill=C.navy;
  s.images.add({blob:new Uint8Array(await fs.readFile(ART)),contentType:"image/png",alt:"Original blue optical-glass abstract cover art",fit:"cover",position:{left:0,top:0,width:1280,height:720}});
  txt(s,"AEGIS  /  LEARNING LAB",72,58,610,32,17,"#D7E6FF",true);
  txt(s,"Spring Boot,\nfrom zero to Aegis",72,205,690,180,57,C.white,true,{lineSpacing:0.98});
  txt(s,"A code-first guide to the API, SQL migrations,\nand the first vertical slice.",76,439,642,88,24,"#D5E4FC",false,{lineSpacing:1.12});
  line(s,76,594,575,"#84A9FF",2);
  txt(s,"PHILIPPE + JIMMY  ·  SEPTEMBER 2026",76,614,665,27,16,"#BFD1EE",true);
  cite(s,"Original background generated specifically for this Aegis learning deck on 2026-09-30. Repository source: README.md; services/api/README.md. No code is shown on this slide.");
}
// 2 — React bridge.
{
  const s=base(2,"Mental model","You already know half the system.","React describes the interface. Spring owns the server-side decisions.");
  card(s,58,271,357,268,"React / Next.js","Component\nState\nFetch call\nRendered result",C.cyan);
  card(s,461,271,357,268,"Spring Boot","Controller\nService\nRepository\nHTTP response",C.blue);
  card(s,864,271,357,268,"Aegis rule","The backend decides whether an asset is ready, reservable, and safe to release.",C.violet);
  txt(s,"UI state can be temporary. Custody and authorization cannot be.",58,575,1164,45,24,C.bright,true);
  cite(s,"Aegis product and authority: README.md (Architecture; Invariants du P0), AGENTS.md. Spring roles: https://docs.spring.io/spring-boot/reference/using/spring-beans-and-dependency-injection.html");
}
// 3 — current stack and honesty about implementation status.
{
  const s=base(3,"Reality check","What the repository actually contains","The architecture is broader than the code that exists today.",true);
  card(s,58,260,546,270,"Running backend slice","Health · POST /auth/login · GET /auth/me\nJava 21 · Spring Boot 4.1.1\nJdbcClient · PostgreSQL · Flyway",C.blue,true);
  card(s,630,260,591,270,"Planned, not implemented yet","Asset catalogue and readiness · reservations\nMQTT command flow · loans and returns\nAdmin workflows · SwiftUI client",C.violet,true);
  shape(s,58,560,1163,72,"#DFE9FB","#C6D7F1",12);
  txt(s,"This deck teaches existing code first and labels future architecture as future.",82,582,1112,35,21,"#1A3761",true);
  cite(s,"Repository snapshot 2026-09-30: services/api/README.md:3-8, 45-58; services/api/pom.xml:29-61; README.md architecture and execution status. Spring Boot project dependencies are current code; planned features are not endpoints yet.");
}
// 4 — boot lifecycle.
{
  const s=base(4,"Runtime","What happens when the API starts","Spring creates the application; Flyway shapes the database before traffic reaches it.");
  const x=[58,353,648,943], labels=["1  CONFIG","2  MIGRATE","3  WIRE","4  SERVE"], bodies=["Read properties and environment","Apply pending versioned SQL","Construct beans and inject dependencies","Bind HTTP routes and handle requests"];
  for(let i=0;i<4;i++){
    shape(s,x[i],290,268,232,i%2?C.panel2:C.panel,C.border,18);
    txt(s,labels[i],x[i]+21,313,226,31,21,i===1?C.violet:C.cyan,true);
    line(s,x[i]+21,358,225,C.border);
    txt(s,bodies[i],x[i]+21,387,226,101,22,C.white,false,{lineSpacing:1.14});
    if(i<3) txt(s,"→",x[i]+271,372,25,40,27,C.blue,true,{align:"center"});
  }
  txt(s,"Flyway is version control for database changes — not a substitute for SQL.",58,568,1164,47,24,C.bright,true);
  cite(s,"AegisControlApplication.java:9-19; application.properties:4-10; services/api/src/main/resources/db/migration/V001__create_schema_and_extensions.sql and V002__create_identity_and_catalog.sql. Official: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html ; https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations . Boot lifecycle wording simplified for pedagogy.");
}
// 5 — Spring application class.
{
  const s=base(5,"Entry point","Two annotations and one entry point","A small class can configure a large application because Spring scans and wires the packages below it.");
  codePanel(s,58,258,647,330,"@SpringBootApplication\npublic class AegisControlApplication {\n  public static void main(String[] args) {\n    SpringApplication.run(\n      AegisControlApplication.class, args);\n  }\n  @Bean\n  Clock clock() {\n    return Clock.systemUTC();\n  }\n}","AEGIS CONTROL APPLICATION · CONDENSED",15);
  card(s,732,258,489,154,"@SpringBootApplication","Entry point for configuration, component scanning, and auto-configuration.",C.blue);
  card(s,732,432,489,156,"@Bean Clock","One reusable UTC time source that Spring can inject into other classes.",C.violet);
  cite(s,"Condensed exact code from services/api/src/main/java/ca/aegis/control/AegisControlApplication.java:9-19. Official auto-configuration: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html ; bean/DI: https://docs.spring.io/spring-boot/reference/using/spring-beans-and-dependency-injection.html .");
}
// 6 — DI.
{
  const s=base(6,"Dependency injection","The container builds the graph","You declare what a class needs; Spring supplies the dependency.");
  codePanel(s,58,258,645,283,"@Repository\nclass AccountRepository {\n  private final JdbcClient jdbc;\n\n  AccountRepository(JdbcClient jdbc) {\n    this.jdbc = jdbc;\n  }\n}","ACCOUNTREPOSITORY.JAVA · EXACT EXCERPT");
  shape(s,738,273,211,89,C.panel2,C.border,18); txt(s,"Spring",764,293,160,45,29,C.white,true);
  shape(s,1011,273,211,89,C.panel2,C.border,18); txt(s,"JdbcClient",1030,300,176,40,23,C.cyan,true);
  shape(s,878,423,283,89,C.panel2,C.border,18); txt(s,"AccountRepository",894,450,252,43,23,C.white,true);
  txt(s,"→",966,295,37,40,31,C.blue,true,{align:"center"});
  txt(s,"injected into",1011,393,211,27,17,C.violet,true,{align:"center"});
  txt(s,"A bean is an object managed by the Spring container.",58,573,1164,45,24,C.bright,true);
  cite(s,"Exact constructor excerpt: services/api/src/main/java/ca/aegis/control/identity/AccountRepository.java:12-22. Spring DI: https://docs.spring.io/spring-boot/reference/using/spring-beans-and-dependency-injection.html . Diagram is pedagogical, not a literal Spring internal object graph.");
}
// 7 — layer responsibilities.
{
  const s=base(7,"Architecture","One request crosses four responsibilities","Keep Aegis business decisions in the service/domain, never in the Web or iOS client.");
  const layers=[
    ["CONTROLLER","HTTP, validation, DTOs",C.cyan],
    ["SERVICE","Rules and use cases",C.blue],
    ["REPOSITORY","Explicit SQL access",C.violet],
    ["DATABASE","Constraints and history",C.green],
  ];
  for(let i=0;i<layers.length;i++){
    let x=58+i*296;
    shape(s,x,288,269,199,C.panel,C.border,18);
    txt(s,layers[i][0],x+21,317,228,34,21,layers[i][2],true);
    txt(s,layers[i][1],x+21,371,226,76,23,C.white,false,{lineSpacing:1.15});
    if(i<3) txt(s,"→",x+271,359,25,46,29,C.blue,true,{align:"center"});
  }
  txt(s,"A controller should not become a place to invent readiness or custody rules.",58,550,1164,70,23,C.bright,true);
  cite(s,"AGENTS.md Work protocol and mandatory invariants; services/api/src/main/java/ca/aegis/control/identity/{AuthController.java,AuthenticationService.java,AccountRepository.java}; V002 SQL. Layer diagram is a learning abstraction of the existing IAM slice.");
}
// 8 — JDBC.
{
  const s=base(8,"Data access","Aegis uses JdbcClient, not JPA","SQL is visible, parameterized, and mapped to a Java record/class.");
  codePanel(s,58,257,733,330,"return jdbc.sql(SELECT_ACCOUNT +\n    \"WHERE lower(email) = lower(:email)\")\n  .param(\"email\", normalizedEmail)\n  .query(AccountRepository::map)\n  .optional();", "ACCOUNTREPOSITORY.JAVA · CONDENSED");
  card(s,815,257,407,151,"What :email means","A named SQL parameter, supplied separately from the SQL text.",C.cyan);
  card(s,815,428,407,159,"What map does","Converts each ResultSet row into an Account domain object.",C.violet);
  cite(s,"Condensed exact code from services/api/src/main/java/ca/aegis/control/identity/AccountRepository.java:12-37, 64-75. Dependencies: services/api/pom.xml:29-61; no JPA starter or Hibernate mapping. Official JDBC guide: https://docs.spring.io/spring-framework/reference/data-access/jdbc.html .");
}
// 9 — Flyway misconception.
{
  const s=base(9,"Schema evolution","Flyway gives SQL a version history","Aegis stores migration scripts in the repository; Flyway applies them in version order.",true);
  shape(s,58,258,536,312,C.lightPanel,"#D1DEF0",18);
  txt(s,"services/api/src/main/resources/",82,284,487,28,18,"#5F76A0",false,{font:CODE});
  txt(s,"db/migration/",82,325,487,31,24,C.darkText,true,{font:CODE});
  line(s,82,369,481,"#D6E2F2");
  txt(s,"V001__create_schema_and_extensions.sql",82,392,487,34,18,"#305FA9",true,{font:CODE});
  txt(s,"V002__create_identity_and_catalog.sql",82,437,487,34,18,"#305FA9",true,{font:CODE});
  txt(s,"Add the next version; do not rewrite V002",82,502,487,31,17,"#547195",false,{font:CODE});
  card(s,623,258,599,143,"1  Versioned files","Every database change has a numbered SQL file.",C.blue,true);
  card(s,623,419,599,151,"2  History table","Flyway records applied versions and checksums to prevent drift.",C.violet,true);
  cite(s,"services/api/src/main/resources/db/migration/V001__create_schema_and_extensions.sql; V002__create_identity_and_catalog.sql; services/api/src/main/resources/application.properties:4-10; services/api/README.md:203-207; FlywayMigrationTests.java:49-69. Official: https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations . Applied-migration edit caution is Flyway guidance; planned V003 name is illustrative, not an existing file.");
}
// 10 — DB constraints.
{
  const s=base(10,"Integrity","The database is the final guardrail","A UI check is helpful. A PostgreSQL constraint still protects the data under concurrency.");
  codePanel(s,58,252,722,313,"CONSTRAINT ck_users_role\n  CHECK (role IN ('ADMIN', 'TECHNICIAN')),\n\nCREATE UNIQUE INDEX ux_users_email_ci\n  ON aegis.users (lower(email));", "V002 SQL · EXACT EXCERPTS");
  card(s,812,252,410,144,"CHECK","Rejects an unsupported role value at write time.",C.cyan);
  card(s,812,415,410,150,"UNIQUE INDEX","Prevents two accounts with the same email ignoring case.",C.green);
  txt(s,"One invariant can appear in UX, service checks, and the database — each layer has a job.",58,587,1160,48,22,C.bright,true);
  cite(s,"Exact excerpts from services/api/src/main/resources/db/migration/V002__create_identity_and_catalog.sql:18-22,102-103. Aegis AGENTS.md calls database constraints final invariant guards. This slide is a conceptual concurrency lesson, not a claim that UI code currently implements user creation.");
}
// 11 — tests.
{
  const s=base(11,"Verification","How do we know it works?","Use tests at the boundary where each failure would surface.",true);
  card(s,58,255,357,277,"HTTP behavior","MockMvc exercises status codes, JSON, authentication, and authorization.",C.blue,true);
  card(s,461,255,357,277,"Real database","Integration tests run against isolated PostgreSQL rather than an in-memory substitute.",C.violet,true);
  card(s,864,255,357,277,"Schema evolution","Flyway tests verify a fresh database and versioned upgrade path.",C.cyan,true);
  shape(s,58,563,1163,73,"#DFE9FB","#C6D7F1",12);
  txt(s,"Compile ≠ verified behavior. Inspect the failing boundary, then add the smallest relevant test.",82,584,1113,40,21,"#1A3761",true);
  cite(s,"services/api/src/test/java/.../ApiIntegrationTest.java:31-68; AuthenticationApiTests.java:67-98,143-170,345-403; FlywayMigrationTests.java:49-69; services/api/README.md tests/bootstrap. File names/lines from repository code map; not a claim that all future components are tested.");
}
// 12 — study exercise, no fake implementation.
{
  const s=base(12,"Practice","Your first 20-minute code tour","Open these four real files in order. Explain each one out loud.");
  const rows=[
    ["01","AegisControlApplication.java","Where does Spring start?"],
    ["02","application.properties","Where are database and Flyway configured?"],
    ["03","V002__create_identity_and_catalog.sql","Which rule does PostgreSQL enforce?"],
    ["04","AccountRepository.java","Where does Java issue parameterized SQL?"],
  ];
  for(let i=0;i<rows.length;i++){
    const y=260+i*83;
    shape(s,58,y,1164,67,i%2?C.panel2:C.panel,C.border,12);
    txt(s,rows[i][0],80,y+17,45,35,23,C.violet,true,{font:CODE});
    txt(s,rows[i][1],144,y+17,500,35,21,C.white,true,{font:CODE});
    txt(s,rows[i][2],660,y+17,536,35,20,C.muted);
  }
  txt(s,"Next module: trace /auth/login and /auth/me end to end.",58,607,1164,40,23,C.bright,true);
  cite(s,"All named files exist in services/api/. Guided questions are educational prompts. Official Spring references: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html ; https://docs.spring.io/spring-framework/reference/data-access/jdbc.html ; Flyway: https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations .");
}

const draft = path.join(WORK,"candidate.pptx");
await (await PresentationFile.exportPptx(P)).save(draft);
const result = await finalizePresentation({
  workspaceDir:WORKSPACE, candidatePath:draft, finalPath:FINAL_PPTX,
  pythonExecutable:PYTHON,
  integrityValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs:["--expected-slide-size-emu","12192000,6858000","--validate-heading-fit"],
  requiredNativeTableOwnerSlides:[],
  fontPolicy:{basis:"design",families:[FONT,CODE]},
  verifyArtifactToolImport:true,
  receiptPath:path.join(WORK,"aegis-spring-foundations-v3.validation.json"),
});
console.log(JSON.stringify({final:FINAL_PPTX,result},null,2));
