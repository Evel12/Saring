import {useEffect,useMemo,useState} from "react";
import {post,request} from "./api";
import {useLoad} from "./hooks";
import {Badge,Failed,Modal,words} from "./ui";
import {dated} from "./InterviewCoordination";
type Slot={id:string;start:number;end:number;timezone:string};
type Schedule={state:string;error:string;offered_slots:Slot[];booked_slot:Slot|null;deadline:number;timezone:string;duration_minutes:number;buffer_minutes:number};
export function SchedulingPortal({applicationId}:{applicationId:string}) {
  const [revision,setRevision]=useState(0);
  const [timezone,setTimezone]=useState("Asia/Jakarta");
  const [start,setStart]=useState("");const [end,setEnd]=useState("");const [expression,setExpression]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [selected,setSelected]=useState<Slot>();
  const [withdraw,setWithdraw]=useState(false);const [reason,setReason]=useState("");
  const q=useLoad(signal=>request<Schedule>("/candidate/applications/"+applicationId+"/scheduling",{signal}),[applicationId,revision]);
  const availabilityKey=useMemo(()=>crypto.randomUUID(),[start,end,timezone,expression]);
  const selectionKey=useMemo(()=>crypto.randomUUID(),[selected?.id]);
  useEffect(()=>{const timer=setInterval(()=>setRevision(x=>x+1),5000);return()=>clearInterval(timer);},[applicationId]);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();setRevision(x=>x+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="portal-section" aria-label="Private interview scheduling"><h2>Interview scheduling</h2>
    {q.error&&<Failed error={q.error} retry={q.reload}/>}{error&&<p role="alert" className="notice warning">{error}</p>}
    {q.data&&<><Badge>{words(q.data.state)}</Badge><p>{q.data.duration_minutes} minutes · {q.data.buffer_minutes}-minute buffers · Scheduling zone: {q.data.timezone}</p><p className="hint">Response deadline: {dated(q.data.deadline,q.data.timezone)}. Availability and selected options are visible only for your own application. Silence makes no statement about your ability.</p>
      {q.data.error&&<p role="status" className="notice warning">{q.data.error}</p>}
      {q.data.booked_slot&&<p className="notice success">{q.data.state==="simulated"?"DEMO booking":"Recorded booking"}: {dated(q.data.booked_slot.start,q.data.booked_slot.timezone)} – {dated(q.data.booked_slot.end,q.data.booked_slot.timezone)}. Email delivery or reading is not implied.</p>}
      <form className="editor-form" onSubmit={e=>{e.preventDefault();act(()=>post("/candidate/applications/"+applicationId+"/availability",{client_key:availabilityKey,timezone,windows:start&&end?[{start,end}]:[],expression}));}}>
        <label>Your availability timezone (IANA)<input required value={timezone} onChange={e=>setTimezone(e.target.value)}/></label>
        <label>Available from (explicit date and time)<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Available until (explicit date and time)<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
        <label>Time expression to clarify (optional)<input value={expression} maxLength={500} placeholder="For example: Thursday afternoon" onChange={e=>setExpression(e.target.value)}/></label>
        <p className="hint">A phrase such as Thursday afternoon will require explicit dated confirmation. It never chooses a booking time.</p>
        <button className="secondary" disabled={busy}>Offer availability / clarify time</button>
      </form>
      {!!q.data.offered_slots.length&&<div><h3>Explicit available options</h3>{q.data.offered_slots.map(slot=><div className="interview-row" key={slot.id}><span>{dated(slot.start,slot.timezone)} – {dated(slot.end,slot.timezone)}</span><button className="primary" disabled={busy||q.data?.state==="booking_queued"} onClick={()=>setSelected(slot)}>{q.data?.booked_slot?"Select rescheduling option":"Select interview option"}</button></div>)}</div>}
      <p className="hint">Selecting a new time updates the existing interview event after another availability check. A conflict requires a new selection; the agent will not pick an alternative silently.</p>
      <button className="secondary danger" onClick={()=>setWithdraw(true)}>Withdraw application and cancel interview</button>
    </>}
    {selected&&<Modal error={error} title="Confirm this exact interview time?" close={()=>setSelected(undefined)}><p>{dated(selected.start,selected.timezone)} – {dated(selected.end,selected.timezone)}</p><p>Availability will be rechecked immediately before booking. You will receive one confirmation request through the approved email service after the calendar action is accepted.</p><button className="primary" disabled={busy} onClick={()=>act(async()=>{await post("/candidate/applications/"+applicationId+"/select-interview-slot",{client_key:selectionKey,slot_id:selected.id});setSelected(undefined);})}>Confirm selected interview time</button></Modal>}
    {withdraw&&<Modal error={error} title="Withdraw this application?" close={()=>setWithdraw(false)}><label>Withdrawal reason<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primary" disabled={busy||!reason.trim()} onClick={()=>act(async()=>{await post("/candidate/applications/"+applicationId+"/withdraw",{reason});setWithdraw(false);setError("Withdrawal recorded. Calendar cleanup is queued; this invitation has closed.");})}>Confirm withdrawal</button></Modal>}
  </section>;
}
