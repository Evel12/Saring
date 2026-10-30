"""Final synthetic journeys exercise generated originals through the actual worker."""
import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update, func
from backend.test_workflow import limits, csrf
from backend.main import app
from backend import models as m
from backend.db import Session, now
from backend.worker import tick


def workspace():
    c=TestClient(app)
    csrf(c)
    assert c.post('/api/demo-session').status_code==200
    csrf(c)
    result=c.post('/api/v1/demo/workspace')
    assert result.status_code==201,result.text
    return c,result.json()['vacancy_ids']


def process(c,v):
    r=c.post('/api/v1/workflow-runs',json={'vacancy_id':v})
    assert r.status_code==201,r.text
    for _ in range(30):
        tick()
        state=c.get('/api/v1/workflow-runs/'+r.json()['id']).json()['state']
        if state in ('done','failed'):return state
    pytest.fail('Worker did not finish bounded synthetic jobs')


def test_reproducible_two_vacancy_five_candidate_seed_real_extraction_and_hostile_text():
    c,vs=workspace()
    assert c.get('/api/v1/candidates').json()['total']==5
    assert c.get('/api/v1/applications').json()['total']==10
    assert c.post('/api/v1/demo/workspace').json()['vacancy_ids']==vs
    assert c.get('/api/v1/applications').json()['total']==10
    assert process(c,vs[1])=='done'
    apps=c.get('/api/v1/applications',params={'vacancy_id':vs[1]}).json()['items']
    for a in apps:
        brief=c.get(f'/api/v1/applications/{a["id"]}/interview-brief').json()
        assert {f['latest_revision']['state'] for f in brief['findings']} <= {'partial','unknown'}
        assert a['decision']=='undecided'
        assert not any('ignore previous' in e['passage'] for e in brief['evidence'])
        artifact=[r for r in brief['requirements'] if r['acceptable_evidence_types']==['work_sample']][0]
        finding=next(f for f in brief['findings'] if f['requirement_id']==artifact['id'])
        assert finding['latest_revision']['state']=='unknown'
        docs=c.get(f'/api/v1/applications/{a["id"]}/documents').json()['items']
        extraction=c.get(f'/api/v1/documents/{docs[0]["id"]}/extractions').json()['items'][0]
        assert extraction['passages'][0]['paragraph'] and extraction['passages'][0]['page'] is None


@pytest.mark.skipif(not os.getenv('TESSERACT_CMD'),reason='Real OCR runtime required; configure TESSERACT_CMD and language data')
def test_real_scanned_pdf_ocr_through_persisted_worker():
    c,vs=workspace()
    response=c.post(f'/api/v1/demo/vacancies/{vs[0]}/synthetic-file',json={'variant':'scan'})
    assert response.status_code==201,response.text
    a=response.json()['application_id']
    assert process(c,vs[0])=='done'
    doc=next(x for x in c.get(f'/api/v1/applications/{a}/documents').json()['items'] if x['original_name']=='synthetic_scan.pdf')
    result=c.get(f'/api/v1/documents/{doc["id"]}/extractions').json()['items'][0]
    assert result['passages'][0]['method']=='tesseract-ocr'
    assert result['passages'][0]['quality']=='ocr-review'
    assert result['passages'][0]['page']==1
    assert 'support' in result['passages'][0]['text'].lower()


def test_malformed_original_exclusion_and_replacement_recovers_without_erasing_history():
    c,vs=workspace()
    result=c.post(f'/api/v1/demo/vacancies/{vs[0]}/synthetic-file',json={'variant':'unreadable'})
    a=result.json()['application_id']
    run=c.post('/api/v1/workflow-runs',json={'vacancy_id':vs[0]}).json()['id']
    for _ in range(20):
        tick()
        with Session() as s:
            jobs=list(s.scalars(select(m.WorkflowJob).where(m.WorkflowJob.run_id==run)))
            for job in jobs:job.available_at=now()-1
            s.commit()
        if c.get(f'/api/v1/workflow-runs/{run}').json()['state']=='failed':break
    doc=next(x for x in c.get(f'/api/v1/applications/{a}/documents').json()['items'] if x['original_name']=='synthetic_unreadable.pdf')
    jobs=c.get(f'/api/v1/workflow-runs/{run}/jobs').json()['items']
    assert any('reupload' in x['error'] for x in jobs)
    assert c.post(f'/api/v1/documents/{doc["id"]}/exclude',json={'reason':'Malformed synthetic original; replace with readable DOCX.'}).status_code==200
    assert c.post(f'/api/v1/demo/applications/{a}/replacement-file',json={'variant':'support'}).status_code==201
    assert process(c,vs[0])=='done'
    docs=c.get(f'/api/v1/applications/{a}/documents').json()['items']
    assert len(docs)==3 and any(x['excluded_at'] for x in docs)
    assert c.get(f'/api/v1/documents/{doc["id"]}/download').status_code==200


def test_public_demo_fixture_and_reset_are_isolated_and_originals_queued_for_cleanup():
    c,vs=workspace()
    other,_=workspace()
    a=c.get('/api/v1/applications').json()['items'][0]
    assert other.post(f'/api/v1/demo/vacancies/{vs[0]}/synthetic-file',json={'variant':'hostile'}).status_code==404
    doc=c.get(f'/api/v1/applications/{a["id"]}/documents').json()['items'][0]
    assert other.get(f'/api/v1/documents/{doc["id"]}/download').status_code==404
    assert c.post('/api/v1/demo/reset').status_code==200
    assert other.get('/api/v1/applications').json()['total']==10
    tick()
    assert c.get('/api/v1/applications').json()['total']==0
