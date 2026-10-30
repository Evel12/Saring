import {test,expect} from '@playwright/test';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import path from 'node:path';
import {createSuggested} from './journey-helpers';
test('UI stays consistent across analysis crash, HR wait and candidate wait worker restarts',async({page,browser})=>{
  test.skip(process.env.SARING_RESTART_E2E!=='1','Opt in with SARING_RESTART_E2E=1 and stop the normal worker first');
  test.setTimeout(120000);
  const python=path.resolve('.venv/Scripts/python.exe');
  let worker:ChildProcess|undefined;
  const start=()=>{worker=spawn(python,['-m','backend.worker'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});};
  const stop=async()=>{if(worker&&worker.exitCode===null){const done=new Promise<void>(resolve=>worker!.once('exit',()=>resolve()));worker.kill();await done;}worker=undefined;};
  try {
    await createSuggested(page,'Customer Support · restart verification','handle complaints');
    const vacancyUrl=page.url();await page.getByLabel('Synthetic CV file').selectOption('support');await page.getByRole('button',{name:'Add synthetic file',exact:true}).click();
    await page.getByRole('link',{name:/Rina Kartika/}).first().click();const id=page.url().split('#/applications/')[1].split('?')[0];await page.goto(vacancyUrl);await page.getByRole('button',{name:'Run agent',exact:true}).click();
    const code=`import os\nfrom backend import worker as w\noriginal=w.review\ndef review(s,j,r,p):\n if j.application_id=='${id}':w.analyze=lambda *a,**k:os._exit(73)\n return original(s,j,r,p)\nw.review=review\nfor _ in range(50):w.tick()\n`;
    const crashed=spawnSync(python,['-c',code],{windowsHide:true,encoding:'utf8',timeout:30000});expect(crashed.status,crashed.stderr).toBe(73);
    const expiry=spawnSync(python,['-c',`from backend.db import Session,now; from backend import models as m; from sqlalchemy import update; s=Session(); s.execute(update(m.WorkflowJob).where(m.WorkflowJob.application_id=='${id}',m.WorkflowJob.state=='running').values(lease_until=now()-1)); s.commit()`],{windowsHide:true,timeout:10000});expect(expiry.status).toBe(0);
    start();await expect(page.getByRole('heading',{name:/clarification drafts? need/})).toBeVisible({timeout:30000});await stop();
    await page.getByRole('link',{name:/Rina Kartika/}).first().click();await page.getByRole('tab',{name:'Clarification',exact:true}).click();await page.getByRole('button',{name:'Review & approve questions'}).click();await page.getByRole('button',{name:'Approve questions',exact:true}).click();
    start();const link=page.getByRole('link',{name:'Open demo candidate portal',exact:true});await expect(link).toBeVisible({timeout:20000});await stop();
    const context=await browser.newContext();const portal=await context.newPage();await portal.goto((await link.getAttribute('href'))!);await portal.getByRole('button',{name:'Continue with private invitation'}).click();await portal.locator('.portal-answers textarea').fill('I handled a complaint about a damaged delivery. I checked the order and courier tracking, offered a replacement and refund option, arranged the replacement and confirmed receipt with the customer two days later.');await portal.getByRole('button',{name:'Review before submitting'}).click();await portal.getByRole('button',{name:'Submit factual answers',exact:true}).click();
    start();await expect(page.getByText('review ready',{exact:true})).toBeVisible({timeout:20000});await expect(page.getByRole('link',{name:'Open demo candidate portal',exact:true})).toHaveCount(1);await context.close();
    await page.getByRole('tab',{name:'Evidence',exact:true}).click();await expect(page.getByText('candidate reported',{exact:true}).first()).toBeVisible();
  } finally {await stop();}
});
