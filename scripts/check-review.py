from playwright.sync_api import sync_playwright
from pathlib import Path
import os
root=Path(__file__).resolve().parent.parent/'review';html=(root/'HMS_Mobile_Review.html').read_text();results=[]
paths={'website':'/','login':'/login','booking':'/book','doctor':'/doctor','staff':'/staff','admin':'/admin','clinical':'/doctor/care','queue':'/staff/opd','leave':'/doctor/leave','team':'/admin/team-management','reports':'/admin/analytics','notifications':'/admin/communications','patient':'/patient','callback':'/request-callback','inquiries':'/staff/inquiries','corrections':'/staff/patient-edit','recovery':'/forgot-password'}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 def render(route,w=390,h=844):
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1,reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.set_content(html.replace("location.hash.slice(1)||'/'",repr(route)));page.wait_for_timeout(100);return page,errors
 for w,h in [(390,844),(320,700),(768,1024),(1440,1000)]:
  for name,route in paths.items():
   page,errors=render(route,w,h);text=page.locator('#root').inner_text();width=page.evaluate('document.documentElement.scrollWidth');ok=not errors and 'Preview route unavailable' not in text and width<=w+1 and len(text)>100;results.append((name,w,ok,width,errors));print(name,w,'PASS' if ok else 'FAIL',width,errors,flush=True)
   if w==390 or (w==1440 and name in ['website','doctor','staff','admin','clinical','reports','team','booking']):page.screenshot(path=str(root/'screenshots'/f'{name}-{w}.png'),full_page=False,animations='disabled')
   page.close()
 def check(name,route,fn):
  page,errors=render(route)
  try:fn(page);assert not errors;results.append((name,390,True,390,[]));print(name,'PASS',flush=True)
  except Exception as e:results.append((name,390,False,390,[str(e)]));print(name,'FAIL',str(e)[:200],flush=True)
  finally:page.close()
 def install(page):
  page.get_by_role('button',name='Install app').click();page.get_by_text('Install on your device').wait_for(timeout=2000);page.screenshot(path=str(root/'screenshots'/'pwa-install-390.png'),animations='disabled');page.get_by_role('button',name='Close',exact=True).click()
 def rx(page):
  page.get_by_role('button',name='Add medicine',exact=True).click();page.get_by_text('Remove item',exact=True).first.wait_for(timeout=2000);assert page.get_by_text('Remove item',exact=True).count()==2;page.get_by_role('button',name='View printable copy').first.click();page.get_by_text('Fictional sample · not for medical use').wait_for(timeout=2000);page.locator('.ops-print').screenshot(path=str(root/'screenshots'/'prescription-390.png'),animations='disabled')
 def invite(page):
  page.get_by_label('Name',exact=True).fill('Example Staff');page.get_by_label('Work email').fill('example@example.test');page.get_by_role('button',name='Invite staff').click();page.get_by_text('Demo invitation created; no email sent.').wait_for(timeout=2000)
 def callback(page):
  page.get_by_label('Your name').fill('Example Person');page.get_by_label('Phone with country code').fill('+919876543210');page.locator('input[type=checkbox]').check();page.get_by_role('button',name='Request callback',exact=True).click();page.get_by_text('Preview request recorded locally. No message was sent.').wait_for(timeout=2000)
 def prefs(page):
  page.get_by_role('checkbox',name='Sms',exact=True).check();page.get_by_text('Preference updated.').wait_for(timeout=2000)
 for n,r,fn in [('install help','/login',install),('prescription preview','/doctor/care',rx),('staff invitation preview','/admin/team-management',invite),('callback demo','/request-callback',callback),('patient preferences','/patient',prefs)]:check(n,r,fn)
 b.close()
failed=[r for r in results if not r[2]];out='Offline source-component browser review (Chromium; React 16 compatibility adapter; demo only)\n'+ '\n'.join(f'{n} @ {w}px: {"PASS" if ok else "FAIL"} (width {width}) {err}' for n,w,ok,width,err in results)+f'\n{len(results)-len(failed)}/{len(results)} passed.\n';(root.parent/'docs'/'QA-phase-three-results.txt').write_text(out);print(out[-500:],flush=True);raise SystemExit(bool(failed))
