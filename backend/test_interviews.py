"""Synthetic accounts; real API/worker paths, deterministic demos and mocked provider HTTP."""
import json
import secrets
import subprocess
import sys
from datetime import datetime,timedelta,timezone
from urllib.parse import urlsplit,parse_qs
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,update,text
from sqlalchemy.exc import IntegrityError
from backend.test_workflow import limits,account,csrf,vacancy,application,upload,run,candidate_session
from backend import models as m,interview_workflow as flow,google_oauth as oauth,scheduling as sched
from backend.db import Session,now
from backend.main import app


def setup(demo=True):
    if demo:
        c=TestClient(app);csrf(c);c.post('/api/demo-session');csrf(c)
        example=c.post('/api/v1/demo/clarification-example').json();v,a=example['vacancy_id'],example['application_id']
        org=c.get('/api/v1/auth/me').json()['org_id'] if 'org_id' in c.get('/api/v1/auth/me').json() else None
        with Session() as s:org=s.get(m.Application,a).org_id
    else:
        c,org,_=account();v,_=vacancy(c);a=application(c,v)
        upload(c,a)
        with Session() as s:s.get(m.Candidate,s.get(m.Application,a).candidate_id).email='candidate@example.test';s.commit()
    run(c,v)
    c.post(f'/api/v1/applications/{a}/decisions',json={'decision':'shortlist','rationale':'Human source review; interview clarifies remaining uncertainties.'})
    generated=c.post(f'/api/v1/applications/{a}/generated-interview-brief').json()
    brief=c.post(f'/api/v1/applications/{a}/brief-drafts',json={'content':generated['content']}).json()
    assert c.post(f"/api/v1/brief-drafts/{brief['id']}/approve",json={'rationale':'Reviewed approved expectations and sources'}).status_code==200
    day=(datetime.now(timezone.utc)+timedelta(days=3)).date()
    recipient='support-applicant@example.test' if demo else 'candidate@example.test'
    data={'client_key':secrets.token_hex(12),'recipient':recipient,'subject':'Interview invitation','draft':'Please offer availability and select an explicit dated option: {portal_url}',
        'confirmation_draft':'Interview confirmed {start} to {end} ({timezone}). {portal_url}','cancellation_draft':'Interview cancelled; contact the recruiter.',
        'timezone':'Asia/Jakarta','window_start':str(day)+'T09:00','window_end':str(day+timedelta(days=3))+'T17:00',
        'duration_minutes':30,'buffer_minutes':10,'interviewers':[{'email':'hr@example.test','calendar_id':'primary','timezone':'Asia/Jakarta','working_hours':[{'weekday':d,'start':'09:00','end':'17:00'} for d in range(7)]}],
        'max_reminders':1,'reminder_hours':24,'response_hours':72,'brief_id':brief['id']}
    result=c.post(f'/api/v1/applications/{a}/interview-plans',json=data)
    assert result.status_code==201,result.text
    return c,org,a,result.json(),data,day


def status(c,a):
    response=c.get(f'/api/v1/applications/{a}/interview-coordination')
    assert response.status_code==200,response.text
    return response.json()['coordination']


def approve(c,plan):
    response=c.post(f"/api/v1/interview-plans/{plan['id']}/approve",json={'rationale':'Explicitly approved recipient, draft, follow-ups, interviewers and scheduling constraints.'})
    assert response.status_code==200,response.text
    return response.json()


def portal(c,org,a):
    with Session() as s:
        coord=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.application_id==a))
        value=flow.token(coord.invitation_id)
    return candidate_session({'token':value})


def availability(candidate,a,day,expression=''):
    result=candidate.post(f'/api/v1/candidate/applications/{a}/availability',json={'client_key':secrets.token_hex(12),'timezone':'Asia/Jakarta','windows':[{'start':str(day)+'T10:00','end':str(day)+'T15:00'}] if not expression else [],'expression':expression})
    assert result.status_code==200,result.text
    return result.json()


def choose(candidate,a,slot,key=None):
    result=candidate.post(f'/api/v1/candidate/applications/{a}/select-interview-slot',json={'client_key':key or secrets.token_hex(12),'slot_id':slot['id']})
    assert result.status_code==200,result.text
    return result.json()


def finish_actions(count=4):
    for _ in range(count):
        if not flow.tick():break


class Providers:
    def __init__(self):
        self.events={};self.messages={};self.calls=[];self.busy=[];self.timeout_insert=False;self.timeout_update=False;self.timeout_email=False;self.timeout_delete=False;self.expired=False;self.identity='synthetic-google-user';self.scope_alias=False
    def __call__(self,request):
        body=json.loads(request.content) if request.content and request.headers.get('content-type','').startswith('application/json') else None
        self.calls.append((request.method,str(request.url),body))
        path=request.url.path
        if request.url.host=='oauth2.googleapis.com':
            if self.expired:return httpx.Response(400,json={'error':'invalid_grant'})
            scope=' '.join(oauth.SCOPES)
            if self.scope_alias:scope=scope.replace(' openid email',' openid https://www.googleapis.com/auth/userinfo.email')
            return httpx.Response(200,json={'access_token':'synthetic-access','refresh_token':'synthetic-refresh','expires_in':3600,'scope':scope})
        if request.url.host=='openidconnect.googleapis.com':return httpx.Response(200,json={'sub':self.identity,'email':'hr@example.test','email_verified':True})
        if request.url.host=='api.resend.com':
            key=request.headers['Idempotency-Key']
            if key in self.messages:assert self.messages[key]['body']==body
            else:self.messages[key]={'body':body,'id':'email-'+str(len(self.messages)+1)}
            if self.timeout_email:self.timeout_email=False;raise httpx.ReadTimeout('Synthetic uncertain acceptance',request=request)
            return httpx.Response(200,json={'id':self.messages[key]['id']})
        assert request.url.host=='www.googleapis.com'
        if path.endswith('/freeBusy'):return httpx.Response(200,json={'calendars':{x['id']:{'busy':self.busy} for x in body['items']}})
        if path.endswith('/events') and request.method=='GET':return httpx.Response(200,json={'items':list(self.events.values()),'timeZone':'Asia/Jakarta'})
        event_id=path.split('/')[-1] if not path.endswith('/events') else body['id']
        event=self.events.get(event_id)
        if request.method=='GET':return httpx.Response(200,json=event) if event else httpx.Response(404,json={'error':'not found'})
        assert request.url.params.get('sendUpdates') in ('all','none')
        if request.method=='POST':
            if event:return httpx.Response(409,json={})
            self.events[event_id]={**body,'etag':'"v1"'}
            if self.timeout_insert:self.timeout_insert=False;raise httpx.ReadTimeout('Synthetic insert accepted before timeout',request=request)
            return httpx.Response(200,json=self.events[event_id])
        if request.method=='PATCH':
            assert request.headers['If-Match']==event['etag']
            self.events[event_id]={**event,**body,'etag':'"v2"'}
            if self.timeout_update:self.timeout_update=False;raise httpx.ReadTimeout('Synthetic update accepted before timeout',request=request)
            return httpx.Response(200,json=self.events[event_id])
        if request.method=='DELETE':
            self.events.pop(event_id,None)
            if self.timeout_delete:self.timeout_delete=False;raise httpx.ReadTimeout('Synthetic cancellation accepted before timeout',request=request)
            return httpx.Response(204)
        raise AssertionError('Unexpected provider request')


def providers(monkeypatch,org,expired=False):
    with Session() as s:
        conn=m.ProviderConnection(org_id=org,provider='google_calendar',state='connected',config={'calendar_id':'primary'})
        s.add(conn);s.flush()
        s.add(m.OAuthCredential(org_id=org,connection_id=conn.id,encrypted_tokens=oauth.encrypt({'access_token':'synthetic-access','refresh_token':'synthetic-refresh'}),expires_at=now()-1 if expired else now()+3600))
        s.add(m.ProviderConnection(org_id=org,provider='email',state='configured',config={'from_email':'hr@example.test'},credential_ref='SARING_TEST_EMAIL'))
        s.commit()
    monkeypatch.setenv('SARING_TEST_EMAIL','synthetic-key')
    monkeypatch.setenv('PUBLIC_APP_URL','https://saring.example.test')
    monkeypatch.setenv('GOOGLE_CLIENT_ID','synthetic-client');monkeypatch.setenv('GOOGLE_CLIENT_SECRET','synthetic-secret');monkeypatch.setenv('GOOGLE_REDIRECT_URI','https://saring.example.test/api/v1/oauth/google/callback')
    fake=Providers();original=httpx.Client
    monkeypatch.setattr('httpx.Client',lambda **kwargs:original(**kwargs,transport=httpx.MockTransport(fake)))
    return fake


def test_demo_approval_portal_booking_reschedule_cancellation_no_live_calls(monkeypatch):
    c,org,a,plan,data,day=setup()
    def forbidden(**kwargs):raise AssertionError('Demo touched a live provider')
    monkeypatch.setattr('httpx.Client',forbidden)
    assert not status(c,a)['actions']
    coord=approve(c,plan);assert approve(c,plan)['id']==coord['id']
    assert len(status(c,a)['actions'])==1
    assert flow.tick()
    candidate=portal(c,org,a)
    ambiguous=availability(candidate,a,day,'Thursday afternoon')
    assert ambiguous['state']=='confirmation_required' and not ambiguous['booked_slot']
    offered=availability(candidate,a,day)
    assert offered['offered_slots']
    key=secrets.token_hex(12);slot=offered['offered_slots'][0]
    choose(candidate,a,slot,key);choose(candidate,a,slot,key);choose(candidate,a,slot)
    finish_actions()
    booked=status(c,a);assert booked['state']=='simulated' and booked['booked_slot']['start']==slot['start']
    event=booked['provider_event_id']
    assert len([x for x in booked['actions'] if x['kind']=='book'])==1
    assert len([x for x in booked['actions'] if x['kind']=='confirmation'])==1
    changed=offered['offered_slots'][2];choose(candidate,a,changed);finish_actions()
    rescheduled=status(c,a);assert rescheduled['provider_event_id']==event and rescheduled['booked_slot']['start']==changed['start']
    assert len([x for x in rescheduled['actions'] if x['kind']=='confirmation'])==2
    assert c.post(f'/api/v1/applications/{a}/interview-coordination/cancel',json={'reason':'Human cancelled this interview.'}).status_code==200
    finish_actions();assert status(c,a)['state']=='cancelled'
    assert c.get('/api/v1/oauth/google/status').json()['state']=='demo'
    assert c.post('/api/v1/oauth/google/start').json()['authorization_url'] is None


def test_exact_approval_versions_recipient_change_and_tenant_denial():
    c,org,a,plan,data,day=setup()
    wrong={**data,'client_key':secrets.token_hex(12),'recipient':'wrong@example.test'}
    p2=c.post(f'/api/v1/applications/{a}/interview-plans',json=wrong).json()
    assert c.post(f"/api/v1/interview-plans/{p2['id']}/approve",json={}).status_code==409
    assert c.post(f"/api/v1/interview-plans/{plan['id']}/approve",json={}).status_code==409
    p3=c.post(f'/api/v1/applications/{a}/interview-plans',json={**data,'client_key':secrets.token_hex(12),'draft':'Revised approved message: {portal_url}'}).json()
    approve(c,p3)
    record=c.get(f'/api/v1/applications/{a}/interview-coordination').json()['authorizations'][0]
    assert record['snapshot']['version']==3 and record['snapshot']['content']['recipient']==data['recipient']
    assert record['content_hash']==p3['content_hash'] and record['actor_id']
    with Session() as s:
        with pytest.raises(IntegrityError):
            s.execute(text("UPDATE interview_plans SET content_hash='changed' WHERE id=:id"),{'id':p3['id']});s.flush()
        s.rollback()
    other,_,_=account()
    assert other.get(f'/api/v1/applications/{a}/interview-coordination').status_code==404
    assert other.post(f"/api/v1/interview-plans/{p3['id']}/approve",json={}).status_code==404


def test_timezone_dst_and_buffers_do_not_silently_guess():
    value=sched.instant('2026-11-05T13:00','Asia/Jakarta')
    assert sched.iso(value).startswith('2026-11-05T06:00')
    for value in ['Thursday afternoon','2026-11-01T01:30']:
        with pytest.raises(Exception):sched.instant(value,'America/New_York')
    with pytest.raises(Exception):sched.instant('2027-03-14T02:30','America/New_York')
    assert sched.instant('2026-11-01T01:30-04:00','America/New_York')!=sched.instant('2026-11-01T01:30-05:00','America/New_York')
    c,org,a,plan,data,day=setup();approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);slot=offered['offered_slots'][0]
    policy=plan['content'];busy=[{'start':slot['end']+60,'end':slot['end']+120}]
    assert not sched.valid_slot(slot['start'],slot['end'],policy,[{'start':slot['start'],'end':slot['end']}],busy,now())


def test_live_conflict_recovery_requires_new_explicit_selection(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);slot=offered['offered_slots'][0];choose(candidate,a,slot)
    fake.busy=[{'start':sched.iso(slot['start']),'end':sched.iso(slot['end'])}]
    assert flow.tick()
    current=status(c,a);assert current['state']=='conflict' and current['booked_slot'] is None and not fake.events
    assert current['offered_slots'] and all(x['id']!=slot['id'] for x in current['offered_slots'])
    choose(candidate,a,current['offered_slots'][-1]);finish_actions()
    assert status(c,a)['state']=='booked' and len(fake.events)==1


def test_live_timeout_reconciliation_and_rescheduling_update_one_event(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);first=offered['offered_slots'][0];choose(candidate,a,first)
    fake.timeout_insert=True;assert flow.tick();current=status(c,a)
    assert current['state']=='delivery_unknown' and len(fake.events)==1
    with Session() as s:
        action=s.scalar(select(m.InterviewAction).where(m.InterviewAction.kind=='book',m.InterviewAction.coordination_id==current['id']))
        action.state='running';action.lease_until=now()-1;action.available_at=now()-1;action.lease_token='dead-worker';s.commit()
    finish_actions()
    assert status(c,a)['state']=='booked'
    assert len([x for x in fake.calls if x[0]=='POST' and '/events' in x[1]])==1
    second=offered['offered_slots'][3];choose(candidate,a,second);fake.timeout_update=True
    assert flow.tick();current=status(c,a);assert current['state']=='delivery_unknown'
    with Session() as s:
        action=s.scalar(select(m.InterviewAction).where(m.InterviewAction.kind=='reschedule',m.InterviewAction.coordination_id==current['id']));action.available_at=now()-1;s.commit()
    finish_actions()
    assert status(c,a)['booked_slot']['start']==second['start'] and len(fake.events)==1
    assert len([x for x in fake.calls if x[0]=='PATCH'])==1
    assert len([x for x in status(c,a)['actions'] if x['kind']=='confirmation'])==2
    assert all('sendUpdates=all' in url for method,url,_ in fake.calls if method in ('PATCH','DELETE') or (method=='POST' and '/events' in url))
    assert next(iter(fake.events.values()))['attendees']==[{'email':'hr@example.test'}]
    assert data['recipient'] not in [p['email'] for p in next(iter(fake.events.values()))['attendees']]


def test_live_email_unknown_retries_same_key_and_never_claims_delivery(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);fake.timeout_email=True
    assert flow.tick();current=status(c,a);assert current['actions'][0]['state']=='delivery_unknown'
    with Session() as s:s.get(m.InterviewAction,current['actions'][0]['id']).available_at=now()-1;s.commit()
    assert flow.tick();current=status(c,a)
    assert current['actions'][0]['state']=='provider_accepted' and len(fake.messages)==1
    assert current['actions'][0]['provider_id']
    assert 'read' not in current['actions'][0] and 'delivered' not in current['actions'][0]


def test_expired_oauth_credentials_and_encrypted_tokens(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org,True);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    fake.expired=True
    result=candidate.post(f'/api/v1/candidate/applications/{a}/availability',json={'client_key':secrets.token_hex(12),'timezone':'Asia/Jakarta','windows':[{'start':str(day)+'T10:00','end':str(day)+'T15:00'}]})
    assert result.status_code==503 and 'expired' in result.text
    assert c.get('/api/v1/oauth/google/status').json()['state']=='expired_credential'
    with Session() as s:
        credential=s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.org_id==org))
        assert 'synthetic-refresh' not in credential.encrypted_tokens
        assert 'encrypted_tokens' not in json.dumps(__import__('backend.services',fromlist=['public']).public(credential))
    assert not fake.events


def test_oauth_state_pkce_scopes_callback_and_refresh(monkeypatch):
    c,org,_=account()
    monkeypatch.setenv('GOOGLE_CLIENT_ID','synthetic-client');monkeypatch.setenv('GOOGLE_CLIENT_SECRET','synthetic-secret');monkeypatch.setenv('GOOGLE_REDIRECT_URI','http://testserver/api/v1/oauth/google/callback')
    # Test server is not a permitted production redirect; use loopback registered URI.
    monkeypatch.setenv('GOOGLE_REDIRECT_URI','http://127.0.0.1:8000/api/v1/oauth/google/callback')
    fake=Providers();original=httpx.Client
    monkeypatch.setattr('httpx.Client',lambda **kwargs:original(**kwargs,transport=httpx.MockTransport(fake)))
    started=c.post('/api/v1/oauth/google/start');assert started.status_code==200,started.text
    params=parse_qs(urlsplit(started.json()['authorization_url']).query)
    assert set(params['scope'][0].split())==set(oauth.SCOPES) and params['code_challenge_method']==['S256']
    state=params['state'][0]
    bad=c.get('/api/v1/oauth/google/callback',params={'state':state,'code':'synthetic-code'},headers={'Cookie':'saring_oauth_state=wrong'},follow_redirects=False)
    assert bad.status_code==403 and not fake.calls
    result=c.get('/api/v1/oauth/google/callback',params={'state':state,'code':'synthetic-code'},follow_redirects=False)
    assert result.status_code==303,result.text
    assert c.get('/api/v1/oauth/google/status').json()['state']=='connected'
    replay=c.get('/api/v1/oauth/google/callback',params={'state':state,'code':'synthetic-code'},headers={'Cookie':'saring_oauth_state='+state},follow_redirects=False)
    assert replay.status_code==400
    with Session() as s:
        credential=s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.org_id==org));credential.expires_at=now()-1;s.commit()
        assert oauth.access_token(s,org)=='synthetic-access'
    assert c.post('/api/v1/oauth/google/disconnect').json()['state']=='disconnected'


def test_withdrawal_cancels_even_an_uncertain_provider_insert(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);choose(candidate,a,offered['offered_slots'][0]);fake.timeout_insert=True;flow.tick()
    assert len(fake.events)==1
    result=candidate.post(f'/api/v1/candidate/applications/{a}/withdraw',json={'reason':'I withdraw my application.'})
    assert result.status_code==200
    finish_actions();assert not fake.events and status(c,a)['state']=='cancelled'
    assert len([x for x in status(c,a)['actions'] if x['kind']=='cancel_confirmation'])==1


def test_request_more_information_is_an_explicit_human_decision():
    c,org,a,plan,data,day=setup()
    result=c.post(f'/api/v1/applications/{a}/decisions',json={'decision':'request_more_information','rationale':'A relevant example still needs human clarification.'})
    assert result.status_code==201,result.text
    assert c.get(f'/api/v1/applications/{a}').json()['decision']=='request_more_information'
    assert c.post(f"/api/v1/interview-plans/{plan['id']}/approve",json={}).status_code==409


def test_worker_restart_reminder_budget_and_response_expiry():
    c,org,a,plan,data,day=setup();approve(c,plan);flow.tick();coord=status(c,a)
    code="from backend import interview_workflow as f,models as m; from backend.db import Session; s=Session(); c=s.get(m.InterviewCoordination,'"+coord['id']+"'); assert c.state=='waiting_availability'; assert not f.tick()"
    restart=subprocess.run([sys.executable,'-c',code],capture_output=True,text=True)
    assert restart.returncode==0,restart.stderr
    with Session() as s:s.get(m.InterviewCoordination,coord['id']).reminder_at=now()-1;s.commit()
    assert flow.tick();assert flow.tick();assert not flow.tick()
    assert len([x for x in status(c,a)['actions'] if x['kind']=='reminder'])==1
    with Session() as s:
        current=s.get(m.InterviewCoordination,coord['id']);current.deadline=now()-1
        inv=s.get(m.CandidateInvitation,current.invitation_id);inv.expires_at=now()-1;value=flow.token(inv.id);s.commit()
    candidate=TestClient(app);csrf(candidate)
    assert candidate.post('/api/v1/auth/invitations/exchange',json={'token':value}).status_code==404
    assert flow.tick() and status(c,a)['state']=='response_timeout'
    assert c.get(f'/api/v1/applications/{a}').json()['decision']=='shortlist'


def test_clarification_authorization_never_authorizes_interview_and_source_brief():
    c,org,a,plan,data,day=setup(False)
    rounds=c.get(f'/api/v1/applications/{a}/clarification-rounds').json()['items']
    assert c.post(f"/api/v1/clarification-rounds/{rounds[0]['id']}/approve",json={}).status_code==200
    assert status(c,a)['plan_id'] is None and not status(c,a)['actions']
    brief=c.post(f'/api/v1/applications/{a}/generated-interview-brief').json()['content']
    assert 'Exact source: Skills: Go' in brief and 'paragraph 1' in brief and '/api/v1/documents/' in brief
    assert 'candidate_reported' in brief and 'Structured interview question' in brief


def test_missing_live_credentials_are_disconnected_without_demo_fallback():
    c,org,a,plan,data,day=setup(False);approve(c,plan);assert flow.tick()
    current=status(c,a)
    assert current['actions'][0]['state']=='not_configured' and current['state']=='needs_attention'
    assert not current['booked_slot']
    assert c.get('/api/v1/oauth/google/status').json()['state']=='disconnected'
    candidate=portal(c,org,a)
    response=candidate.post(f'/api/v1/candidate/applications/{a}/availability',json={'client_key':secrets.token_hex(12),'timezone':'Asia/Jakarta','windows':[{'start':str(day)+'T10:00','end':str(day)+'T15:00'}]})
    assert response.status_code==503 and 'disconnected' in response.text


def test_timeout_cancellation_is_reconciled_before_retry_and_not_duplicated(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);choose(candidate,a,offered['offered_slots'][0]);finish_actions()
    c.post(f'/api/v1/applications/{a}/interview-coordination/cancel',json={'reason':'Recruiter cancelled.'});fake.timeout_delete=True
    assert flow.tick();assert status(c,a)['state']=='delivery_unknown'
    with Session() as s:
        action=s.scalar(select(m.InterviewAction).where(m.InterviewAction.coordination_id==status(c,a)['id'],m.InterviewAction.kind=='cancel'));action.available_at=now()-1;s.commit()
    finish_actions();assert status(c,a)['state']=='cancelled'
    assert len([x for x in fake.calls if x[0]=='DELETE'])==1
    assert len([x for x in status(c,a)['actions'] if x['kind']=='cancel_confirmation'])==1


def test_recipient_change_needs_new_version_and_renewed_approval(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan)
    with Session() as s:s.get(m.Candidate,s.get(m.Application,a).candidate_id).email='corrected@example.test';s.commit()
    assert flow.tick() and status(c,a)['actions'][0]['state']=='not_configured' and not fake.messages
    revised=c.post(f'/api/v1/applications/{a}/interview-plans',json={**data,'client_key':secrets.token_hex(12),'recipient':'corrected@example.test'}).json()
    approve(c,revised);assert flow.tick()
    assert len(fake.messages)==1 and next(iter(fake.messages.values()))['body']['to']==['corrected@example.test']
    assert len(c.get(f'/api/v1/applications/{a}/interview-coordination').json()['authorizations'])==2


def test_google_account_binding_survives_disconnect_and_canonical_scope_alias(monkeypatch):
    c,org,a,plan,data,day=setup(False)
    monkeypatch.setenv('GOOGLE_CLIENT_ID','synthetic-client');monkeypatch.setenv('GOOGLE_CLIENT_SECRET','synthetic-secret');monkeypatch.setenv('GOOGLE_REDIRECT_URI','http://127.0.0.1:8000/api/v1/oauth/google/callback')
    fake=Providers();fake.scope_alias=True;original=httpx.Client
    monkeypatch.setattr('httpx.Client',lambda **kwargs:original(**kwargs,transport=httpx.MockTransport(fake)))
    def connect():
        started=c.post('/api/v1/oauth/google/start');assert started.status_code==200
        state=parse_qs(urlsplit(started.json()['authorization_url']).query)['state'][0]
        return c.get('/api/v1/oauth/google/callback',params={'state':state,'code':'synthetic-code'},follow_redirects=False)
    assert connect().status_code==303
    approve(c,plan)
    assert c.post('/api/v1/oauth/google/disconnect').json()['state']=='disconnected'
    fake.identity='different-google-account'
    result=connect();assert result.status_code==503 and 'different Google account' in result.text
    assert c.get('/api/v1/oauth/google/status').json()['state']=='disconnected'


def test_optional_interviewer_notifications_and_candidate_guest_denial(monkeypatch):
    c,org,a,plan,data,day=setup(False)
    bad={**data,'client_key':secrets.token_hex(12),'interviewers':[{**data['interviewers'][0],'email':data['recipient']}]}
    assert c.post(f'/api/v1/applications/{a}/interview-plans',json=bad).status_code==422
    second=c.post(f'/api/v1/applications/{a}/interview-plans',json={**data,'client_key':secrets.token_hex(12),'notify_interviewers':False}).json()
    fake=providers(monkeypatch,org);approve(c,second);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);choose(candidate,a,offered['offered_slots'][0]);finish_actions()
    assert status(c,a)['state']=='booked'
    event=next(iter(fake.events.values()));assert event['attendees']==[]
    assert all('sendUpdates=none' in url for method,url,_ in fake.calls if method=='POST' and '/events' in url)


def test_unapproved_calendar_participants_require_reconciliation(monkeypatch):
    c,org,a,plan,data,day=setup(False);fake=providers(monkeypatch,org);approve(c,plan);flow.tick();candidate=portal(c,org,a)
    offered=availability(candidate,a,day);choose(candidate,a,offered['offered_slots'][0]);finish_actions()
    event=next(iter(fake.events.values()));event['attendees'].append({'email':'unapproved@example.test'})
    choose(candidate,a,offered['offered_slots'][3]);assert flow.tick()
    assert status(c,a)['state']=='conflict'
    assert not [x for x in fake.calls if x[0]=='PATCH']
    assert len([x for x in status(c,a)['actions'] if x['kind']=='confirmation'])==1
