import {useMemo, useState} from "react";
import {all, post, request} from "./api";
import {useLoad} from "./hooks";
import {useApp, Badge, Failed, Modal, words} from "./ui";
import type {Snapshot, BriefDraft} from "./types";

type Plan={id:string;version:number;content_hash:string;brief_id:string|null;content:Record<string,unknown>};
type Action={id:string;kind:string;state:string;error:string;provider_id:string|null};
type Coordination={id:string;state:string;error:string;provider_event_id:string;booked_slot:null|{start:number;end:number;timezone:string};actions:Action[]};
const dateAfter=(days:number,hour:string)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10)+"T"+hour;
export const dated=(seconds:number,tz:string)=>new Intl.DateTimeFormat("en-GB",{dateStyle:"full",timeStyle:"short",timeZone:tz}).format(new Date(seconds*1000))+" · "+tz;

export function InterviewCoordination({row}:{row:Snapshot}) {
  const {org,revision,perform,busy}=useApp();
  const [recipient,setRecipient]=useState(row.candidate?.email||"");
  const [subject,setSubject]=useState("Interview invitation");
  const [draft,setDraft]=useState("We would like to invite you to an interview. Please provide explicit dated availability and select a time in your private portal: {portal_url}");
  const [confirmation,setConfirmation]=useState("Your interview is confirmed for {start} to {end} ({timezone}). Use your portal for changes: {portal_url}");
  const [cancellation,setCancellation]=useState("This interview coordination has been cancelled. Contact your recruiter with any questions.");
  const [calendarTitle,setCalendarTitle]=useState("Saring interview");
  const [calendarDescription,setCalendarDescription]=useState("Recruiter-approved interview. Evidence and private notes remain in Saring.");
  const [notifyInterviewers,setNotifyInterviewers]=useState(true);
  const [timezone,setTimezone]=useState("Asia/Jakarta");
  const [start,setStart]=useState(dateAfter(1,"09:00"));
  const [end,setEnd]=useState(dateAfter(8,"17:00"));
  const [duration,setDuration]=useState(30);
  const [buffer,setBuffer]=useState(10);
  const [reminders,setReminders]=useState(1);
  const [hours,setHours]=useState(72);
  const [people,setPeople]=useState([{email:org.is_demo?"interviewer@example.test":"",calendar_id:"primary",timezone:"Asia/Jakarta",weekdays:[0,1,2,3,4],start:"09:00",end:"17:00"}]);
  const [approve,setApprove]=useState<Plan>();
  const [approved,setApproved]=useState(false);
  const [reason,setReason]=useState("");
  const [cancel,setCancel]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
  const q=useLoad(async(signal)=>{
    const [plans,status,briefs,mailbox]=await Promise.all([
      all<Plan>("/applications/"+row.application.id+"/interview-plans",signal),
      request<{coordination:Coordination|null;authorizations:{plan_id:string;actor_id:string;created_at:number}[]}>("/applications/"+row.application.id+"/interview-coordination",{signal}),
      all<BriefDraft>("/applications/"+row.application.id+"/brief-drafts",signal),
      org.is_demo?request<{items:{id:string;kind:string;recipient:string;portal_url:string}[]}>("/demo/interview-mailbox?application_id="+row.application.id,{signal}):Promise.resolve({items:[]})
    ]);
    return {plans,status,briefs,mailbox};
  },[row.application.id,revision]);
  const brief=q.data?.briefs.filter(b=>b.state==="approved").sort((a,b)=>b.revision-a.revision)[0];
  const latest=q.data?.plans.sort((a,b)=>b.version-a.version)[0];
  const policy={recipient,subject,draft,confirmation_draft:confirmation,cancellation_draft:cancellation,calendar_title:calendarTitle,calendar_description:calendarDescription,notify_interviewers:notifyInterviewers,duration_minutes:duration,buffer_minutes:buffer,timezone,window_start:start,window_end:end,
    max_reminders:reminders,reminder_hours:24,response_hours:hours,brief_id:brief?.id||null,
    interviewers:people.map(p=>({email:p.email,calendar_id:p.calendar_id,timezone:p.timezone,working_hours:p.weekdays.map(day=>({weekday:day,start:p.start,end:p.end}))}))};
  const key=useMemo(()=>crypto.randomUUID(),[JSON.stringify(policy)]);
  const coord=q.data?.status.coordination;
  return <section className="decision-box">
    <h3>Interview invitation & scheduling</h3>
    <p className="hint">A human shortlist and approved brief are required. Invitation approval covers the exact recipient, drafts, one optional reminder, constraints, explicit candidate slot selection, in-policy rescheduling and one confirmation per change. Clarification approval grants no interview permission.</p>
    {q.error&&<Failed error={q.error} retry={q.reload}/>}
    <form className="editor-form" onSubmit={e=>{e.preventDefault();perform(()=>post("/applications/"+row.application.id+"/interview-plans",{...policy,client_key:key}),"Interview plan version saved; review invitation approval before any send.");}}>
      <label>Interview recipient<input type="email" required value={recipient} onChange={e=>setRecipient(e.target.value)}/></label>
      <label>Interview email subject<input required value={subject} maxLength={200} onChange={e=>setSubject(e.target.value)}/></label>
      <label>Interview invitation draft<textarea required value={draft} maxLength={4000} onChange={e=>setDraft(e.target.value)}/></label>
      <label>Booking and rescheduling confirmation draft<textarea required value={confirmation} maxLength={2000} onChange={e=>setConfirmation(e.target.value)}/></label>
      <label>Cancellation confirmation draft<textarea required value={cancellation} maxLength={2000} onChange={e=>setCancellation(e.target.value)}/></label>
      <label>Google calendar event title<input required value={calendarTitle} maxLength={200} onChange={e=>setCalendarTitle(e.target.value)}/></label>
      <label>Google calendar event description<textarea required value={calendarDescription} maxLength={2000} onChange={e=>setCalendarDescription(e.target.value)}/></label>
      <label className="checkbox"><input type="checkbox" checked={notifyInterviewers} onChange={e=>setNotifyInterviewers(e.target.checked)}/>Invite the approved interviewers through Google Calendar and send them event updates. Candidate messages use the email adapter only.</label>
      <p className="hint">Available placeholders: {"{portal_url}, {start}, {end}, {timezone}"}. Private brief/evidence is never included automatically in email.</p>
      <label>Scheduling timezone (IANA)<input required value={timezone} onChange={e=>setTimezone(e.target.value)}/></label>
      <div className="detail-grid"><label>Earliest scheduling date<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>Latest scheduling date<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
      <div className="detail-grid"><label>Interview duration (minutes)<input type="number" min={15} max={120} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label><label>Buffer on each side (minutes)<input type="number" min={0} max={60} value={buffer} onChange={e=>setBuffer(Number(e.target.value))}/></label></div>
      {people.map((person,index)=><fieldset key={index}><legend>Interviewer {index+1}</legend>
        {(["email","calendar_id","timezone"] as const).map(field=><label key={field}>{field==="email"?"Interviewer email":field==="calendar_id"?"Interviewer Google calendar ID":"Interviewer IANA timezone"}<input required type={field==="email"?"email":"text"} value={person[field]} onChange={e=>setPeople(xs=>xs.map((p,i)=>i===index?{...p,[field]:e.target.value}:p))}/></label>)}
        <div className="tags">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((name,day)=><label className="checkbox" key={day}><input type="checkbox" checked={person.weekdays.includes(day)} onChange={e=>setPeople(xs=>xs.map((p,i)=>i===index?{...p,weekdays:e.target.checked?[...p.weekdays,day]:p.weekdays.filter(d=>d!==day)}:p))}/>{name}</label>)}</div>
        <label>Working hours start<input type="time" required value={person.start} onChange={e=>setPeople(xs=>xs.map((p,i)=>i===index?{...p,start:e.target.value}:p))}/></label><label>Working hours end<input type="time" required value={person.end} onChange={e=>setPeople(xs=>xs.map((p,i)=>i===index?{...p,end:e.target.value}:p))}/></label>
        {people.length>1&&<button type="button" className="secondary" onClick={()=>setPeople(xs=>xs.filter((_,i)=>i!==index))}>Remove interviewer</button>}
      </fieldset>)}
      <button type="button" className="secondary" disabled={people.length>=5} onClick={()=>setPeople([...people,{email:"",calendar_id:"primary",timezone,weekdays:[0,1,2,3,4],start:"09:00",end:"17:00"}])}>Add interviewer</button>
      <label>Allowed interview reminders<select value={reminders} onChange={e=>setReminders(Number(e.target.value))}><option value={0}>None</option><option value={1}>At most one after 24 hours</option></select></label>
      <label>Scheduling response deadline (hours)<input type="number" min={25} max={168} value={hours} onChange={e=>setHours(Number(e.target.value))}/></label>
      <button className="secondary" disabled={busy||row.application.decision!=="shortlist"||!brief||row.application.reassessment_required}>Save interview plan draft</button>
      {!brief&&<p className="notice warning">Save and approve the interview brief above before saving an invitation plan.</p>}
    </form>
    {latest&&<div className="round-card"><h3>Plan version {latest.version}</h3><p>Recipient: {String(latest.content.recipient)}</p><p className="hint">Any changed recipient, content or policy requires a new version and renewed approval.</p>{!q.data?.status.authorizations.some(a=>a.plan_id===latest.id)&&<button className="primary" disabled={busy} onClick={()=>{setApprove(latest);setApproved(false);setReason("");}}>Review interview invitation approval</button>}</div>}
    {coord&&<div className="round-card"><div className="label-row"><h3>Persisted scheduling status</h3><Badge>{words(coord.state)}</Badge></div>{coord.booked_slot&&<p>{dated(coord.booked_slot.start,coord.booked_slot.timezone)}</p>}{coord.error&&<p role="status" className="notice warning">{coord.error}</p>}
      <p className="hint">Google event identifier: {coord.provider_event_id}. Email acceptance is not evidence of delivery or reading.</p>
      {org.is_demo && coord.state==="options_ready" && <button className="secondary" disabled={busy} onClick={()=>perform(()=>post("/demo/applications/"+row.application.id+"/calendar-conflict",{}),"DEMO: first offered slot is now busy. The candidate must select, receive the persisted conflict, then explicitly choose an alternative.")}>Simulate calendar conflict · DEMO</button>}
      {coord.actions.map(action=><div className="source-card" key={action.id}><b>{words(action.kind)} · {words(action.state)}</b>{action.provider_id&&<p className="tiny">Provider reference: {action.provider_id}</p>}{action.error&&<p>{action.error}</p>}{["failed","delivery_unknown","not_configured","expired_credential"].includes(action.state)&&<button className="secondary" disabled={busy} onClick={()=>perform(()=>post("/interview-actions/"+action.id+"/retry",{}),"Provider reconciliation/retry queued with the same identifier.")}>Reconcile or retry interview action</button>}</div>)}
      {q.data?.mailbox.items.filter(m=>["invite","reminder"].includes(m.kind)).slice(-1).map(m=><div className="notice" key={m.id}><div><b>DEMO interview mailbox · {m.recipient}</b><p>No email was transmitted. Use a separate browser profile.</p><a className="secondary" href={m.portal_url} target="_blank" rel="noreferrer">Open demo scheduling portal</a></div></div>)}
      {coord.state!=="cancelled"&&<button className="secondary danger" onClick={()=>setCancel(true)}>Cancel interview coordination</button>}
    </div>}
    {approve&&<Modal title="Approve this interview invitation and scheduling policy?" close={()=>setApprove(undefined)}><div className="editor-form"><p>Version {approve.version} · Recipient {String(approve.content.recipient)}</p><pre className="brief-preview">{JSON.stringify(approve.content,null,2)}</pre><p>Permits explicit candidate selections within these constraints, one candidate confirmation per booking/reschedule, and cancellation of the existing event if the application is withdrawn or the shortlist is revoked. If enabled above, Google invites and updates only the approved interviewers with this event title and description. The candidate is excluded from Google attendees and receives only approved email-adapter messages.</p><label className="checkbox"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>I approve this exact interview recipient, content and bounded scheduling policy.</label><label>Interview authorization reason<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primary" disabled={busy||!approved||!reason.trim()} onClick={()=>perform(async()=>{await post("/interview-plans/"+approve.id+"/approve",{rationale:reason});setApprove(undefined);},"Interview authorization saved; invitation queued, not claimed delivered.")}>Approve interview invitation</button></div></Modal>}
    {cancel&&<Modal title="Cancel this interview coordination?" close={()=>setCancel(false)}><div className="editor-form"><p>The worker will reconcile and cancel the existing event, then send one confirmation under the approved cancellation policy.</p><label>Cancellation reason<textarea required value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label><button className="primary" disabled={busy||!cancelReason.trim()} onClick={()=>perform(async()=>{await post("/applications/"+row.application.id+"/interview-coordination/cancel",{reason:cancelReason});setCancel(false);},"Cancellation queued; provider cleanup remains pending.")}>Confirm interview cancellation</button></div></Modal>}
  </section>;
}
