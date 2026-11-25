from playwright.sync_api import sync_playwright
from pathlib import Path
root=Path(__file__).resolve().parent.parent
html=(root/'review/HMS_Mobile_Review.html').read_text()
shots=root/'review/screenshots';results=[]
paths={'website':'/','booking':'/book','manage-booking':'/manage-booking','history':'/doctor/history','prescription-register':'/staff/prescription-register','cancel-policy':'/admin/cancellation-policy'}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 def run(name,route,w,h,hi=False,interact=False):
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1,reduced_motion='reduce');page.set_default_timeout(1800);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   page.set_content(html.replace("location.hash.slice(1)||'/'",repr(route)));page.wait_for_timeout(60)
   if hi:page.get_by_role('button',name='हिंदी',exact=True).last.click();page.wait_for_timeout(60)
   if name in ['history','prescription-register']:page.get_by_role('button',name='खोजें' if hi else 'Search',exact=True).last.click();page.wait_for_timeout(60);assert 'PT-000127' in page.locator('#root').inner_text()
   if name=='manage-booking':
    page.get_by_role('button',name='बुकिंग खोजें' if hi else 'Find booking',exact=True).click();page.wait_for_timeout(60);assert 'BK-00012A7' in page.locator('#root').inner_text()
    if w==390:page.screenshot(path=str(shots/f'{name}-{ "hi" if hi else "en"}-{w}.png'),animations='disabled')
    page.get_by_role('button',name='बुकिंग रद्द करें' if hi else 'Cancel booking',exact=True).click();assert page.locator('dialog').is_visible();assert all(x in page.locator('dialog').inner_text() for x in ['₹500.00','₹50.00','₹450.00']);assert page.locator('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1');
    if w==390:page.screenshot(path=str(shots/f'cancel-dialog-{ "hi" if hi else "en"}-{w}.png'),animations='disabled')
    page.get_by_role('button',name='रद्दीकरण की पुष्टि करें' if hi else 'Confirm cancellation',exact=True).click();page.wait_for_timeout(70);assert ('डेमो बुकिंग रद्द हुई' if hi else 'Demo booking cancelled') in page.locator('#root').inner_text()
   width=page.evaluate('document.documentElement.scrollWidth');assert width<=w+1,(width,w);assert not errors,errors;assert len(page.locator('#root').inner_text())>100
   if w in (390,1440) and name!='manage-booking':page.screenshot(path=str(shots/f'{name}-{ "hi" if hi else "en"}-{w}.png'),animations='disabled')
   results.append((name,w,hi,'PASS'))
  except Exception as e:results.append((name,w,hi,'FAIL '+str(e)[:200]));print(results[-1],flush=True)
  finally:page.close()
 for name,route in paths.items():
  for w,h,hi in [(390,844,False),(390,844,True),(320,700,True),(768,1024,False),(1440,1000,True)]:run(name,route,w,h,hi)
 b.close()
text='Offline Chromium component review; no live database or payment calls.\n'+'\n'.join(str(r) for r in results)+f'\n{sum(r[-1]=="PASS" for r in results)}/{len(results)} passed.\n'
(root/'docs/QA-review-results.txt').write_text(text);print(text[-1000:],flush=True)
