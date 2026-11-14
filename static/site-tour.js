(() => {
  const steps = [
    {selector:'.campus-header',title:'Welcome to Arounus',copy:'This is the local market. You can browse rooms, rides, items and services before creating an account.'},
    {selector:'#openMarketSearch',title:'Search nearby listings',copy:'Select this search icon to choose a location or organisation, enter what you need, and filter the listing categories.'},
    {selector:'.arounus-footer__links a[href*="account=register"]',title:'Create an account',copy:'Select Sign up to create your account. Choose Customer to browse and message providers, or a provider type if you want to publish listings.'},
    {selector:'.campus-header [data-open-sell]',title:'Start a listing',copy:'After signing in, select Sell or list. You can list a room, a ride, an item for sale, or another service.'},
    {selector:'.campus-header [data-open-sell]',title:'Preview, then publish',copy:'Choose the listing type, add its title, location, price, contact details and photos. Review the preview and publish when everything looks right.'},
    {selector:'#showSavedListings',title:'Find saved listings',copy:'Use Saved to return to listings you bookmarked while browsing.'},
    {selector:'.academic-link',title:'Explore learning',copy:'Open Learning for modules, lessons and quizzes. You can return to the market from there whenever you like.'},
  ];
  let stepIndex = 0, active = false, previousFocus = null;
  let scrim, spotlight, card, counter, heading, copy, back, next;

  function close() {
    if (!active) return;
    active = false;
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position);
    document.removeEventListener('keydown', onKeydown);
    scrim.remove(); spotlight.remove(); card.remove();
    previousFocus?.focus?.({preventScroll:true});
  }

  function position() {
    if (!active) return;
    const target = document.querySelector(steps[stepIndex].selector);
    if (!target) return;
    const rect = target.getBoundingClientRect(), pad = 6;
    const top = Math.max(8, rect.top - pad), left = Math.max(8, rect.left - pad);
    const width = Math.min(innerWidth - left - 8, rect.width + pad * 2);
    const height = Math.min(innerHeight - top - 8, rect.height + pad * 2);
    Object.assign(spotlight.style,{top:`${top}px`,left:`${left}px`,width:`${width}px`,height:`${height}px`});
    const cardWidth = card.offsetWidth, cardHeight = card.offsetHeight;
    const below = rect.bottom + 18 + cardHeight <= innerHeight - 12 || rect.top < cardHeight + 30;
    const cardTop = below ? Math.min(innerHeight-cardHeight-12,rect.bottom+18) : Math.max(12,rect.top-cardHeight-18);
    const cardLeft = Math.max(16,Math.min(innerWidth-cardWidth-16,rect.left+rect.width/2-cardWidth/2));
    card.style.top = `${Math.max(12,cardTop)}px`;
    card.style.left = `${cardLeft}px`;
    card.style.setProperty('--tour-arrow-left',`${Math.max(20,Math.min(cardWidth-20,rect.left+rect.width/2-cardLeft))}px`);
    card.dataset.placement = below ? 'below' : 'above';
  }

  function show(index) {
    stepIndex = index;
    const step = steps[index], target = document.querySelector(step.selector);
    if (!target) { if (index < steps.length - 1) show(index + 1); else close(); return; }
    counter.textContent = `Step ${index + 1} of ${steps.length}`;
    heading.textContent = step.title;
    copy.textContent = step.copy;
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    target.scrollIntoView({behavior:'auto',block:'center'});
    requestAnimationFrame(() => {position();next.focus({preventScroll:true});});
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...card.querySelectorAll('button:not([hidden])')];
    if (event.shiftKey && document.activeElement === controls[0]) {event.preventDefault();controls.at(-1).focus();}
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault();controls[0].focus();}
  }

  function open() {
    if (active) return;
    active = true; previousFocus = document.activeElement;
    scrim = document.createElement('div'); scrim.className = 'arounus-tour-scrim';
    spotlight = document.createElement('div'); spotlight.className = 'arounus-tour-spotlight';spotlight.setAttribute('aria-hidden','true');
    card = document.createElement('section');card.className = 'arounus-tour-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','arounusTourTitle');
    card.innerHTML = '<div class="arounus-tour-top"><span class="arounus-tour-step"></span><button class="arounus-tour-close" type="button" aria-label="Close tour">×</button></div><h2 id="arounusTourTitle"></h2><p></p><div class="arounus-tour-actions"><button type="button" data-tour-skip>Skip</button><button type="button" data-tour-back>Back</button><button class="arounus-tour-next" type="button" data-tour-next>Next</button></div>';
    document.body.append(scrim,spotlight,card);
    counter=card.querySelector('.arounus-tour-step');heading=card.querySelector('h2');copy=card.querySelector('p');back=card.querySelector('[data-tour-back]');next=card.querySelector('[data-tour-next]');
    card.querySelector('.arounus-tour-close').onclick=close;
    card.querySelector('[data-tour-skip]').onclick=close;
    back.onclick=()=>show(stepIndex-1);
    next.onclick=()=>stepIndex===steps.length-1?close():show(stepIndex+1);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,{passive:true});
    document.addEventListener('keydown',onKeydown);
    show(0);
  }

  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if (!link || new URL(link.href,location.href).searchParams.get('tour') !== '1' || new URL(link.href,location.href).pathname !== location.pathname) return;
    event.preventDefault();open();
  });
  if (new URLSearchParams(location.search).get('tour') === '1') {
    const url=new URL(location.href);url.searchParams.delete('tour');history.replaceState(history.state,'',url);
    window.addEventListener('load',()=>setTimeout(open,1000),{once:true});
  }
})();
