/*
 * The 12 profit leaks: one source of truth for the calculators on
 * compassbizsolutions.com/numbers and for the printable workbooks.
 * Every number in a trade's "ex" block is an EXAMPLE shop, not a benchmark.
 * calc(v) returns the math as steps so the page and the PDF show the same work.
 */
(function (root) {
  var TRADES = {
    general: { code: 'gen', name: 'Trades & Home Service', short: 'trades', owners: 'trades and home service owners', worker: 'tech', workers: 'techs', slot: 'job', slots: 'jobs',
      extra: 'the "while I\'m here" fix you did but never wrote up', plan: 'a yearly maintenance visit', parts: 'parts and supplies', supplier: 'the supply house',
      slow: 'the slow stretch of the year', noshow: 'no-shows and last-minute cancellations',
      ex: { ticket: 500, jobs: 20, crew: 3, wage: 30, weeks: 48, rate: 95, overhead: 175000, billable: 26, empty: 2, slotValue: 500, customers: 600, planNow: 5, planTarget: 15, planPrice: 200, repeat: 25, repeatTarget: 35, materials: 120000, markup: 15, markupTarget: 30, officeHrs: 12, runs: 4, unbilled: 35, uncollected: 800, custValue: 500, missed: 8, close: 50, fixed: 22000, slowRev: 15000, slowMonths: 3 } },
    hvac: { code: 'hvac', name: 'HVAC', short: 'HVAC', owners: 'HVAC company owners', worker: 'tech', workers: 'techs', slot: 'service call', slots: 'service calls',
      extra: 'the capacitor you swapped "while you were there" and never billed', plan: 'a twice-a-year tune-up plan', parts: 'capacitors, contactors and filters', supplier: 'the supply house',
      slow: 'the spring and fall shoulder seasons', noshow: 'no-shows and "can we do next week?" cancellations',
      ex: { ticket: 550, jobs: 22, crew: 3, wage: 32, weeks: 50, rate: 115, overhead: 230000, billable: 26, empty: 2, slotValue: 550, customers: 700, planNow: 10, planTarget: 20, planPrice: 220, repeat: 35, repeatTarget: 45, materials: 150000, markup: 25, markupTarget: 40, officeHrs: 12, runs: 4, unbilled: 40, uncollected: 1100, custValue: 550, missed: 8, close: 50, fixed: 30000, slowRev: 20000, slowMonths: 3 } },
    plumbing: { code: 'plumb', name: 'Plumbing', short: 'plumbing', owners: 'plumbing company owners', worker: 'plumber', workers: 'plumbers', slot: 'service call', slots: 'service calls',
      extra: 'the shutoff valve you replaced and never wrote up', plan: 'a yearly water heater flush and inspection plan', parts: 'fittings, valves and cartridges', supplier: 'the supply house',
      slow: 'the slower summer months', noshow: 'no-shows and last-minute cancellations',
      ex: { ticket: 450, jobs: 25, crew: 3, wage: 33, weeks: 50, rate: 110, overhead: 220000, billable: 26, empty: 2, slotValue: 450, customers: 800, planNow: 3, planTarget: 12, planPrice: 150, repeat: 30, repeatTarget: 40, materials: 130000, markup: 20, markupTarget: 35, officeHrs: 10, runs: 5, unbilled: 30, uncollected: 900, custValue: 450, missed: 10, close: 50, fixed: 28000, slowRev: 22000, slowMonths: 2 } },
    electrical: { code: 'elec', name: 'Electrical', short: 'electrical', owners: 'electrical contractors', worker: 'electrician', workers: 'electricians', slot: 'service call', slots: 'service calls',
      extra: 'the extra outlet or switch you added and never billed', plan: 'a yearly safety check or generator service plan', parts: 'breakers, wire and devices', supplier: 'the supply house',
      slow: 'the slower months after the holidays', noshow: 'no-shows and last-minute cancellations',
      ex: { ticket: 520, jobs: 18, crew: 3, wage: 35, weeks: 50, rate: 110, overhead: 210000, billable: 26, empty: 1, slotValue: 520, customers: 500, planNow: 2, planTarget: 10, planPrice: 179, repeat: 25, repeatTarget: 35, materials: 110000, markup: 15, markupTarget: 30, officeHrs: 12, runs: 4, unbilled: 45, uncollected: 1000, custValue: 520, missed: 7, close: 50, fixed: 27000, slowRev: 20000, slowMonths: 2 } },
    'general-contracting': { code: 'gc', name: 'General Contracting', short: 'general contracting', owners: 'general contractors', worker: 'carpenter', workers: 'crew', slot: 'crew day', slots: 'crew days',
      extra: 'the extra trim, blocking or change the homeowner asked for that never became a change order', plan: 'a seasonal home maintenance visit', parts: 'lumber, hardware and fasteners', supplier: 'the lumber yard',
      slow: 'winter', noshow: 'crew days lost to gaps between jobs',
      ex: { ticket: 6000, jobs: 2, crew: 4, wage: 30, weeks: 46, rate: 75, overhead: 170000, billable: 30, empty: 0.5, slotValue: 2400, customers: 90, planNow: 0, planTarget: 10, planPrice: 300, repeat: 15, repeatTarget: 20, materials: 200000, markup: 10, markupTarget: 20, officeHrs: 15, runs: 6, unbilled: 250, uncollected: 1500, custValue: 6000, missed: 3, close: 25, fixed: 35000, slowRev: 20000, slowMonths: 3 } },
    roofing: { code: 'roof', name: 'Roofing', short: 'roofing', owners: 'roofing company owners', worker: 'roofer', workers: 'crew', slot: 'crew day', slots: 'crew days',
      extra: 'the rotted decking or extra flashing you replaced and never billed', plan: 'a yearly roof inspection and gutter check', parts: 'shingles, flashing and drip edge', supplier: 'the supplier',
      slow: 'winter', noshow: 'rain-out days that never got rebooked',
      ex: { ticket: 11000, jobs: 1.5, crew: 5, wage: 27, weeks: 38, rate: 75, overhead: 200000, billable: 30, empty: 0.5, slotValue: 3000, customers: 70, planNow: 0, planTarget: 15, planPrice: 199, repeat: 10, repeatTarget: 15, materials: 260000, markup: 12, markupTarget: 20, officeHrs: 15, runs: 3, unbilled: 300, uncollected: 2000, custValue: 11000, missed: 3, close: 20, fixed: 40000, slowRev: 10000, slowMonths: 3 } },
    landscaping: { code: 'land', name: 'Landscaping', short: 'landscaping', owners: 'landscaping company owners', worker: 'crew member', workers: 'crew', slot: 'stop', slots: 'stops',
      extra: 'the extra yard of mulch or bed edging you did and never added to the bill', plan: 'a spring and fall cleanup package with aeration', parts: 'plants, mulch and irrigation parts', supplier: 'the nursery or supply yard',
      slow: 'winter', noshow: 'skipped or rained-out stops that never got made up',
      ex: { ticket: 120, jobs: 60, crew: 4, wage: 21, weeks: 32, rate: 60, overhead: 120000, billable: 32, empty: 3, slotValue: 120, customers: 150, planNow: 40, planTarget: 60, planPrice: 650, repeat: 60, repeatTarget: 75, materials: 60000, markup: 15, markupTarget: 30, officeHrs: 10, runs: 5, unbilled: 15, uncollected: 360, custValue: 2000, missed: 5, close: 50, fixed: 25000, slowRev: 4000, slowMonths: 4 } },
    handyman: { code: 'handy', name: 'Handyman', short: 'handyman', owners: 'handyman business owners', worker: 'handyman', workers: 'helpers', slot: 'job', slots: 'jobs',
      extra: 'the "while you\'re here, can you…" fix you did for free', plan: 'a quarterly home check-up visit', parts: 'hardware and supplies', supplier: 'the hardware store',
      slow: 'the slow weeks after the holidays', noshow: 'no-shows and last-minute cancellations',
      ex: { ticket: 275, jobs: 14, crew: 1, wage: 30, weeks: 48, rate: 85, overhead: 55000, billable: 24, empty: 1, slotValue: 275, customers: 250, planNow: 0, planTarget: 10, planPrice: 300, repeat: 35, repeatTarget: 45, materials: 25000, markup: 0, markupTarget: 20, officeHrs: 8, runs: 5, unbilled: 20, uncollected: 550, custValue: 275, missed: 8, close: 50, fixed: 6000, slowRev: 4500, slowMonths: 2 } },
    painting: { code: 'paint', name: 'Painting', short: 'painting', owners: 'painting company owners', worker: 'painter', workers: 'crew', slot: 'crew day', slots: 'crew days',
      extra: 'the extra coat or trim work you added and never charged for', plan: 'a yearly touch-up visit', parts: 'paint and supplies', supplier: 'the paint store',
      slow: 'winter, when exterior work stops', noshow: 'rain days on exterior jobs that never got made up',
      ex: { ticket: 3800, jobs: 2.5, crew: 4, wage: 24, weeks: 40, rate: 60, overhead: 110000, billable: 32, empty: 0.5, slotValue: 1920, customers: 100, planNow: 0, planTarget: 10, planPrice: 250, repeat: 15, repeatTarget: 20, materials: 60000, markup: 10, markupTarget: 25, officeHrs: 12, runs: 3, unbilled: 120, uncollected: 1000, custValue: 3800, missed: 3, close: 25, fixed: 25000, slowRev: 12000, slowMonths: 3 } }
  };

  function $(n) { n = Math.round(n || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }
  function $2(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function num(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US'); }

  // field(key, label, unit, help): unit is '$', '%', 'hrs', '#', 'min', 'wks', 'mo'
  function F(key, label, unit, help) { return { key: key, label: label, unit: unit, help: help || '' }; }

  var LEAKS = [
    { id: 'pricing', code: 'pricing', n: 1, name: 'The Pricing Leak', short: 'Pricing', tagline: 'Find the hourly rate that actually pays you',
      what: 'Your rate has to cover more than wages. Payroll taxes, insurance, trucks, tools, phones, software and what you pay yourself all come out of every billable hour. When the rate was set by "what feels right" or "what the other guys charge", it often sits barely above break-even, or under it.',
      why: 'Rates get set once and then left alone for years while wages, insurance and fuel go up. Every year you wait, the gap gets a little wider, and it\'s invisible because the jobs still feel busy.',
      signs: ['You\'re busy all the time but there\'s nothing left at the end of the month', 'You haven\'t raised your rate in 2 or more years', 'You set your price by what competitors charge', 'You don\'t know your cost for one billable hour', 'You pay yourself last, or not every week', 'You hesitate before giving a price because it "feels high"'],
      fields: [F('wage', 'Average hourly wage you pay a {worker}', '$'), F('burden', 'Payroll taxes, workers comp and benefits on top of wages', '%', 'Often 20–35%. Your payroll provider can tell you yours.'), F('overhead', 'Yearly overhead: trucks, insurance, rent, phones, software, what you pay yourself', '$'), F('crew', 'Billable {workers} (count yourself if you do field work)', '#'), F('billable', 'Billable hours per {worker} per week', 'hrs', 'Not hours on the clock: hours you can actually bill.'), F('weeks', 'Working weeks per year', 'wks'), F('rate', 'Your current hourly rate', '$'), F('margin', 'Profit you want to keep on each hour', '%')],
      defaults: { burden: 25, margin: 20 },
      calc: function (v) {
        var loaded = v.wage * (1 + v.burden / 100), hrs = v.crew * v.billable * v.weeks, oh = hrs ? v.overhead / hrs : 0, be = loaded + oh, target = be / (1 - v.margin / 100), gap = Math.max(0, target - v.rate), total = gap * hrs;
        return { total: total, steps: [
          ['Labor cost per hour', $2(v.wage) + ' wage × ' + (1 + v.burden / 100).toFixed(2), $2(loaded)],
          ['Billable hours per year', num(v.crew) + ' × ' + num(v.billable) + ' hrs × ' + num(v.weeks) + ' weeks', num(hrs) + ' hrs'],
          ['Overhead per billable hour', $(v.overhead) + ' ÷ ' + num(hrs) + ' hrs', $2(oh)],
          ['Break-even rate', $2(loaded) + ' + ' + $2(oh), $2(be)],
          ['Rate that keeps ' + v.margin + '% profit', $2(be) + ' ÷ ' + (1 - v.margin / 100).toFixed(2), $2(target)],
          ['Short on every hour', $2(target) + ' − ' + $2(v.rate), $2(gap)],
          ['Left on the table each year', $2(gap) + ' × ' + num(hrs) + ' hrs', $(total)]
        ], note: gap > 0 ? '' : 'Your rate already covers break-even plus your profit target. Check this again every January.' };
      },
      fixes: [
        ['Work out your real cost per hour', 'Fill in the worksheet with last year\'s real numbers: payroll reports, insurance bills, truck payments. Guesses make the rate wrong.'],
        ['Set your new rate from the math', 'Use the "rate that keeps your profit" line, rounded up to a clean number. That\'s your floor, not your ceiling.'],
        ['Raise it for new work first', 'New quotes get the new rate starting Monday. Honor every quote you already gave.'],
        ['Tell existing customers with notice', 'Give regular customers two weeks\' notice with the short text below. Contracts change at renewal, not mid-term.'],
        ['Put a date on it every year', 'Put "check my rate" on the calendar for the same week every year, so it never sits for five years again.']],
      script: { title: 'Rate update text for existing customers', body: 'Hi [Name], it\'s [Your name] from [Business]. Quick heads up: starting [date], our rate goes to $[new rate]/hr. Our costs for insurance, fuel and parts have gone up, and I want to keep doing the job right. Anything already scheduled or quoted stays at the old price. Thanks for sticking with us!' },
      week: ['Pull last year\'s payroll total and insurance bills', 'Add up yearly truck, phone, software and shop costs', 'Fill in the worksheet and find your break-even rate', 'Pick your new rate (round up)', 'Update your price sheet, quote template and software', 'Send the rate text to your regular customers', 'Put next year\'s rate check on the calendar'] },

    { id: 'scheduling', code: 'sched', n: 2, name: 'The Scheduling Black Hole', short: 'Scheduling', tagline: 'What empty slots and no-shows really cost',
      what: 'Every {slot} that sits empty is money you can never get back. A truck rolls, a {worker} gets paid, and nothing gets billed. {noshowCap} feel like small hiccups, but they add up to a big number by the end of the year.',
      why: 'Most shops send a reminder text and call it confirmed. A text nobody answers isn\'t a confirmation. Without a fill-in list, an opening stays empty even when people are waiting for a {slot}.',
      signs: ['You get at least one no-show or late cancel most weeks', 'Reminder texts go out, but nobody has to reply', 'When a slot opens, nobody gets called to fill it', 'You don\'t charge for late cancellations', '{workersCap} sit around or go home early when a {slot} falls through', 'You can\'t say how many {slots} went empty last month'],
      fields: [F('empty', 'Empty or no-show {slots} per week', '#', 'Count {noshow}.'), F('slotValue', 'What one {slot} is worth', '$'), F('weeks', 'Working weeks per year', 'wks'), F('refill', 'Share you could realistically fill or prevent', '%')],
      defaults: { refill: 50 },
      calc: function (v) {
        var lost = v.empty * v.slotValue * v.weeks, back = lost * v.refill / 100;
        return { total: back, steps: [
          ['Lost each week', num(v.empty) + ' × ' + $(v.slotValue), $(v.empty * v.slotValue)],
          ['Lost each year', $(v.empty * v.slotValue) + ' × ' + num(v.weeks) + ' weeks', $(lost)],
          ['What you could win back', $(lost) + ' × ' + v.refill + '%', $(back)]
        ] };
      },
      fixes: [
        ['Confirm by asking for a reply', 'The day before, send a text that asks for a YES. No reply by 3pm means a phone call.'],
        ['Keep a fill-in list', 'Keep a running list of people who said "call me if something opens up." When a slot opens, work the list before lunch.'],
        ['Put your cancel policy in writing', 'Put a late-cancel or trip fee in your quotes and booking texts. You don\'t have to charge it every time, but say it.'],
        ['Take a deposit on bigger work', 'Booked work with a deposit almost never no-shows.'],
        ['Count empty slots every Friday', 'Write down how many slots went empty each week. What gets counted gets fixed.']],
      script: { title: 'Day-before confirmation text', body: 'Hi [Name], it\'s [Business]. You\'re on the schedule tomorrow between [time window] at [address]. Reply YES to confirm, or let me know if we need to move it. We have a waiting list, so a heads up helps a lot. Thanks!' },
      week: ['Count last month\'s empty or no-show slots', 'Write your day-before confirmation text', 'Start a fill-in list in your phone or software', 'Add a late-cancel line to your quotes', 'Call 3 past customers who said "whenever you have an opening"', 'Decide which jobs need a deposit', 'Start counting empty slots every Friday'] },

    { id: 'employee-cost', code: 'labor', n: 3, name: 'The Employee Cost Leak', short: 'Employee cost', tagline: 'Paid hours vs. billable hours',
      what: 'You pay for every hour on the clock, but you only get paid for the hours you bill. The time in between (loading the truck, waiting on parts, driving, starting late, waiting on the office) is paid but never billed. A few hours per {worker} per week is a big yearly number.',
      why: 'Nobody tracks it, because it doesn\'t look like waste. It looks like a normal day. Mornings start late, routes zig-zag, and the shop run turns into an hour.',
      signs: ['{workersCap} roll out of the shop after 8:00', 'Paid hours are way higher than billed hours on your payroll report', 'Overtime shows up but revenue doesn\'t', 'Routes cross town more than once a day', '{workersCap} wait on you for answers or approvals', 'You\'ve never compared paid hours to billed hours'],
      fields: [F('crew', 'Number of {workers}', '#'), F('recover', 'Extra billable hours you could win per {worker} per week', 'hrs', 'Start small. Start with two: a faster morning and tighter routes can do it.'), F('rate', 'Your hourly rate', '$'), F('weeks', 'Working weeks per year', 'wks')],
      defaults: { recover: 2 },
      calc: function (v) {
        var h = v.crew * v.recover * v.weeks, total = h * v.rate;
        return { total: total, steps: [
          ['Billable hours won back per year', num(v.crew) + ' × ' + num(v.recover) + ' hrs × ' + num(v.weeks) + ' weeks', num(h) + ' hrs'],
          ['Value at your rate', num(h) + ' hrs × ' + $(v.rate), $(total)]
        ] };
      },
      fixes: [
        ['Compare paid hours to billed hours', 'Put last month\'s payroll hours next to last month\'s billed hours. The difference is your leak.'],
        ['Load the trucks the night before', 'Load tomorrow\'s parts the afternoon before, so mornings start at the first job, not at the shop.'],
        ['Group jobs by area', 'Book jobs in the same part of town on the same day. Less driving means more billing.'],
        ['Write down the answers they keep asking for', 'Pricing, common fixes, who to call: a one-page cheat sheet means fewer calls to you.'],
        ['Set a first-job start time', 'Agree on when the first job starts, not when people show up at the shop.']],
      script: { title: 'Team huddle (5 minutes)', body: 'This week we\'re working on one thing: getting to the first job earlier. Trucks get loaded the afternoon before, and the first job starts by [time]. If something slows you down in the morning, tell me. I\'d rather fix the system than have you wait around.' },
      week: ['Print last month\'s payroll hours', 'Print last month\'s billed hours', 'Find the gap per {worker}', 'Start loading trucks the day before', 'Book next week\'s jobs by area', 'Write the one-page answer sheet', 'Hold a 5-minute huddle on start times'] },

    { id: 'recurring-revenue', code: 'plan', n: 4, name: 'The Recurring Revenue Gap', short: 'Recurring revenue', tagline: 'Money that shows up before the phone rings',
      what: 'If every month starts at zero, you\'re only as good as this week\'s phone calls. A simple plan like {plan} brings in money and booked work even in {slow}, and plan customers call you first when something breaks.',
      why: 'Most shops never offer a plan because it feels like selling. But your happiest customers would sign up if you asked at the end of a good job.',
      signs: ['Revenue swings a lot month to month', 'You dread {slow}', 'Fewer than 1 in 10 customers is on any kind of plan', 'Customers call someone else because they forgot your name', 'You don\'t have a plan to offer', 'Nobody asks for the plan at the end of a job'],
      fields: [F('customers', 'Customers you served last year', '#'), F('planNow', 'Share on a plan today', '%'), F('planTarget', 'Share you\'d like on a plan', '%'), F('planPrice', 'What a plan brings in per customer per year', '$')],
      defaults: {},
      calc: function (v) {
        var add = v.customers * Math.max(0, v.planTarget - v.planNow) / 100, total = add * v.planPrice;
        return { total: total, steps: [
          ['New plan customers', num(v.customers) + ' × (' + v.planTarget + '% − ' + v.planNow + '%)', num(add)],
          ['New yearly plan revenue', num(add) + ' × ' + $(v.planPrice), $(total)]
        ] };
      },
      fixes: [
        ['Build one simple plan', 'One plan, one price, what\'s included in three lines. Start with {plan}.'],
        ['Ask at the end of every good job', 'The best time to offer it is when the customer is happy. Use the script below.'],
        ['Make it automatic', 'Bill monthly or yearly by card on file, so it renews without you chasing it.'],
        ['Book plan visits in your slow season', 'Use plan visits to fill {slow}.'],
        ['Track how many customers are on the plan', 'Count plan customers on the first of every month.']],
      script: { title: 'Plan offer at the end of a job', body: 'Glad we got that fixed. A lot of our customers are on our [plan name]: [what\'s included] for $[price] a year, and they get priority scheduling. Want me to put you on it so you don\'t have to think about it?' },
      week: ['Pick what goes in your plan', 'Set the yearly price', 'Write the 3-line description', 'Set up card-on-file billing', 'Practice the offer script', 'Offer it on every job this week', 'Text 20 past customers about the plan'] },

    { id: 'estimate-to-invoice', code: 'extras', n: 5, name: 'The Estimate-to-Invoice Leak', short: 'Estimate-to-invoice', tagline: 'Work you did but never billed',
      what: 'Somewhere between the quote and the invoice, work slips through: {extra}. A small amount per {slot} turns into thousands a year.',
      why: 'Extra work gets agreed to on the spot, out loud, and never written down. By the time the invoice goes out, nobody remembers it, or it feels awkward to add.',
      signs: ['Customers ask for "one more thing" on most jobs', 'Change orders are verbal', 'Final invoices match the quote even when the job grew', '{workersCap} don\'t tell the office about extra work', 'You eat small extras to keep customers happy', 'You\'ve finished a job and thought "we lost money on that one"'],
      fields: [F('unbilled', 'Unbilled extras on an average {slot}', '$', 'Small stuff counts: parts, extra time, a second trip.'), F('jobs', '{slotsCap} per week', '#'), F('weeks', 'Working weeks per year', 'wks')],
      defaults: {},
      calc: function (v) {
        var total = v.unbilled * v.jobs * v.weeks;
        return { total: total, steps: [
          ['Unbilled per week', $(v.unbilled) + ' × ' + num(v.jobs), $(v.unbilled * v.jobs)],
          ['Unbilled per year', $(v.unbilled * v.jobs) + ' × ' + num(v.weeks) + ' weeks', $(total)]
        ] };
      },
      fixes: [
        ['Write down every extra before you do it', 'Get a quick text or signature on extra work before you start it. One line is enough.'],
        ['Use a job-close checklist', 'Before leaving, check: extra parts? extra time? second trip? Then add them to the invoice.'],
        ['Price common extras ahead of time', 'Make a short list of the extras that come up all the time, with prices, so nobody has to guess.'],
        ['Compare quote to invoice weekly', 'Every Friday, look at 5 jobs and compare what you quoted with what you billed.'],
        ['Give the {workers} a simple script', 'Arm them with the words below, so asking about extras feels normal, not awkward.']],
      script: { title: 'Extra-work text before starting', body: 'Hi [Name], while we\'re here we found [issue]. Fixing it today is $[price] extra. Reply YES and we\'ll take care of it now, or we can leave it for another time.' },
      week: ['Pull your last 10 jobs: quote vs invoice', 'List the 5 extras that come up most', 'Put a price on each one', 'Write the extra-work text', 'Add a job-close checklist', 'Show the {workers} the text and checklist', 'Start the Friday quote-vs-invoice check'] },

    { id: 'cash-flow', code: 'cash', n: 6, name: 'The Cash Flow Blind Spot', short: 'Cash flow', tagline: 'Getting through {slow} without panic',
      what: 'A business can be profitable on paper and still run out of cash. Bills come every month, but work doesn\'t. In {slow}, the money coming in can drop below what goes out, and the gap lands on a credit card.',
      why: 'Most owners watch the bank balance, not the calendar. The cash cushion that should be built in the busy months gets spent, and the slow months turn into stress.',
      signs: ['You put payroll or supplies on a credit card in slow months', 'Your bank balance decides when you pay yourself', 'You don\'t know your fixed monthly costs off the top of your head', 'Busy season money disappears by {slow}', 'You take any job in the slow season, even at a loss', 'You don\'t have a separate savings account for the business'],
      fields: [F('fixed', 'Fixed costs per month (payroll, trucks, insurance, rent, your pay)', '$'), F('slowRev', 'Money coming in during a slow month', '$'), F('slowMonths', 'Number of slow months a year', 'mo')],
      defaults: {},
      calc: function (v) {
        var gap = Math.max(0, v.fixed - v.slowRev), total = gap * v.slowMonths;
        return { total: total, isCushion: true, steps: [
          ['Short each slow month', $(v.fixed) + ' − ' + $(v.slowRev), $(gap)],
          ['Cushion you need saved', $(gap) + ' × ' + num(v.slowMonths) + ' months', $(total)],
          ['Set aside each busy month', $(total) + ' ÷ ' + num(12 - v.slowMonths) + ' busy months', $(total / Math.max(1, 12 - v.slowMonths))]
        ], note: 'This isn\'t money lost. It\'s the cushion that keeps you off credit cards.' };
      },
      fixes: [
        ['Know your monthly number', 'Add up everything that goes out every month, no matter what. That\'s the number to beat.'],
        ['Open a separate cushion account', 'Move the "set aside" amount from the worksheet into it every busy month, automatically.'],
        ['Take deposits', 'Take a deposit when bigger jobs are booked, so the work pays for its own materials.'],
        ['Fill the slow months on purpose', 'Book plan visits, follow-ups and old quotes into {slow} before it arrives.'],
        ['Look 8 weeks ahead every Monday', 'A quick look at booked work against your monthly number gets rid of most surprises.']],
      script: { title: 'Slow-season fill text to past customers', body: 'Hi [Name], it\'s [Business]. We have a few openings in [month] and this is a great time for [service]. Want me to get you on the schedule before the busy season?' },
      week: ['List every monthly bill', 'Add them up: that\'s your monthly number', 'Look at last year\'s slow-month deposits', 'Fill in the worksheet', 'Open a cushion savings account', 'Set an automatic transfer', 'Text past customers about slow-season openings'] },

    { id: 'customer-churn', code: 'repeat', n: 7, name: 'The Customer Churn Leak', short: 'Customer churn', tagline: 'Customers who never call back',
      what: 'The cheapest job you\'ll ever win is from someone who already hired you. When customers don\'t come back, it\'s usually not because they were unhappy. They just forgot your name and called the first number they found.',
      why: 'Most shops finish the job, get paid and never reach out again. No thank-you, no reminder, no review ask. A year later the customer doesn\'t remember who came out.',
      signs: ['You don\'t have a list of past customers in one place', 'You never contact customers after the job', 'Most of your work is from new customers', 'You don\'t ask for reviews or referrals', 'You only hear from customers when something breaks', 'You don\'t know your repeat rate'],
      fields: [F('customers', 'Customers you served last year', '#'), F('repeat', 'Share who came back this year', '%'), F('repeatTarget', 'Share you\'d like to come back', '%'), F('custValue', 'What a returning customer spends in a year', '$')],
      defaults: {},
      calc: function (v) {
        var more = v.customers * Math.max(0, v.repeatTarget - v.repeat) / 100, total = more * v.custValue;
        return { total: total, steps: [
          ['More repeat customers', num(v.customers) + ' × (' + v.repeatTarget + '% − ' + v.repeat + '%)', num(more)],
          ['Extra revenue a year', num(more) + ' × ' + $(v.custValue), $(total)]
        ] };
      },
      fixes: [
        ['Put every customer on one list', 'Name, phone, email, what you did, when. A spreadsheet is fine.'],
        ['Send a same-day thank-you', 'A short text the day of the job, with a review link.'],
        ['Set reminders by job type', 'Check-in reminders at 6 or 12 months, depending on what you did.'],
        ['Ask for referrals out loud', 'Happy customers refer when you ask. Use the script below.'],
        ['Count repeat customers monthly', 'How many jobs this month were from past customers? Write it down.']],
      script: { title: 'Thank-you and review text', body: 'Thanks for having us out today, [Name]! If you have a minute, a quick review really helps a small business like ours: [link]. And if anyone you know needs a [trade] they can trust, we\'d love the referral.' },
      week: ['Export or gather last year\'s customer list', 'Put it in one spreadsheet', 'Write your thank-you + review text', 'Send it after every job this week', 'Text 20 customers from last year', 'Set 6-month reminders for new jobs', 'Count repeat customers this month'] },

    { id: 'materials-markup', code: 'markup', n: 8, name: 'The Materials Markup Fix', short: 'Materials markup', tagline: 'Stop reselling {parts} at cost',
      what: 'When you buy {parts}, pick them up, carry them and stand behind them, that\'s work. Passing them through at cost, or close to it, means doing all of that for free.',
      why: 'Markup feels like overcharging, so many owners keep it low or skip it. Meanwhile supplier prices creep up and the margin on materials shrinks every year.',
      signs: ['You charge customers what you paid for parts', 'Your markup is the same as it was years ago', 'You don\'t know your supplier price changes', 'Customers see your receipts', 'You eat the cost of returns and wrong parts', 'You\'ve never set a markup policy'],
      fields: [F('materials', 'What you spend on materials per year', '$'), F('markup', 'Your average markup today', '%'), F('markupTarget', 'Markup you want to charge', '%', 'Pick a number that fits your market and covers handling, trips and warranty.')],
      defaults: {},
      calc: function (v) {
        var total = v.materials * Math.max(0, v.markupTarget - v.markup) / 100;
        return { total: total, steps: [
          ['Markup gap', v.markupTarget + '% − ' + v.markup + '%', (v.markupTarget - v.markup) + '%'],
          ['Extra margin a year', $(v.materials) + ' × ' + (v.markupTarget - v.markup) + '%', $(total)]
        ] };
      },
      fixes: [
        ['Set one markup policy', 'One simple rule, like a set percent on everything, or tiers by part price. Write it down.'],
        ['Price from today\'s cost', 'Check supplier prices monthly, or when an invoice looks different.'],
        ['Stop showing receipts', 'Quote and invoice the price, not your cost plus a line.'],
        ['Charge for the trip', 'A special-order part means a second trip, so put that trip on the bill.'],
        ['Check 10 invoices a month', 'Compare part cost to part price on 10 invoices to make sure the policy sticks.']],
      script: { title: 'If a customer asks about part prices', body: 'Our part price includes sourcing it, picking it up, bringing the right one, and our warranty if it fails. That\'s why it\'s not the same as the shelf price, and why we stand behind it.' },
      week: ['Pull last year\'s materials spend', 'Check 10 recent invoices: cost vs charged', 'Pick your markup policy', 'Update your price list or software', 'Stop attaching supplier receipts', 'Tell the {workers} the new policy', 'Set a monthly supplier price check'] },

    { id: 'admin-time', code: 'admin', n: 9, name: 'The Admin Time Drain', short: 'Admin time', tagline: 'Your nights back from paperwork',
      what: 'Quotes, invoices, scheduling, chasing payments and answering the same questions eat your evenings. Every hour you spend on paperwork is an hour you\'re not billing, not selling and not home.',
      why: 'It starts small and grows with the business. Nothing is written down, so everything runs through you, and every task is done by hand from scratch.',
      signs: ['You do paperwork at night or on Sundays', 'You type every quote and invoice from scratch', 'You answer the same customer questions every day', 'Only you know how things work', 'You\'re the bottleneck for approvals', 'A family member helps "for free" at night'],
      fields: [F('officeHrs', 'Hours a week you spend on office work', 'hrs'), F('handoff', 'Hours you could cut, hand off or automate', 'hrs', 'Templates, a part-time helper or software. Half is a fair start.'), F('rate', 'What your hour is worth (your billed rate)', '$'), F('weeks', 'Working weeks per year', 'wks')],
      defaults: {},
      prep: function (v) { if (v.handoff == null) v.handoff = Math.round(v.officeHrs / 2); },
      calc: function (v) {
        var total = v.handoff * v.rate * v.weeks;
        return { total: total, steps: [
          ['Hours freed per year', num(v.handoff) + ' hrs × ' + num(v.weeks) + ' weeks', num(v.handoff * v.weeks) + ' hrs'],
          ['Value of those hours', num(v.handoff * v.weeks) + ' hrs × ' + $(v.rate), $(total)]
        ] };
      },
      fixes: [
        ['Track a week of office time', 'Write down every office task and how long it takes. The list will surprise you.'],
        ['Template the top 3', 'Quotes, invoices and the most common reply texts: build each one once and reuse it.'],
        ['Batch it', 'Two set office blocks a week, not 20 minutes every night.'],
        ['Write down how things work', 'One page per task, so someone else can do it.'],
        ['Hand off one task this month', 'Pick the most repetitive task and give it to a helper, a part-timer or software.']],
      script: { title: 'Common-question reply you can save', body: 'Thanks for reaching out! Our next openings are [days]. Our [service] starts at $[price], and we confirm the exact price on site before any work starts. Want me to grab a time for you?' },
      week: ['Track every office task for 7 days', 'Circle the 3 that take the most time', 'Build a quote template', 'Build an invoice template', 'Save your 5 most common replies', 'Set two office blocks on the calendar', 'Pick one task to hand off'] },

    { id: 'vehicles-parts', code: 'parts', n: 10, name: 'The Vehicles & Parts Leak', short: 'Vehicles & parts', tagline: 'The real cost of a run to {supplier}',
      what: 'A forgotten fitting or the wrong part means a run to {supplier}: drive time, wait time, fuel and a {worker} who isn\'t billing. One run a day feels normal, and that\'s what makes it expensive.',
      why: 'Trucks get restocked from memory, not a list. Nobody knows what\'s on the truck until it\'s missing.',
      signs: ['Someone goes to {supplier} most days', 'Trucks are stocked differently from each other', 'There\'s no restock list', 'Jobs stop while someone gets a part', 'Return trips happen for missing parts', 'Fuel and truck costs keep climbing'],
      fields: [F('runs', 'Unplanned parts runs per week', '#'), F('runMin', 'Minutes per run (drive + wait)', 'min'), F('loaded', 'Labor cost per hour for whoever goes', '$'), F('truckCost', 'Fuel and wear per run', '$'), F('weeks', 'Working weeks per year', 'wks')],
      defaults: { runMin: 45, truckCost: 15 },
      prep: function (v) { if (v.loaded == null) v.loaded = Math.round(v.wage * 1.25); },
      calc: function (v) {
        var per = v.runMin / 60 * v.loaded + v.truckCost, total = per * v.runs * v.weeks;
        return { total: total, steps: [
          ['Cost of one run', v.runMin + ' min of ' + $(v.loaded) + '/hr + ' + $(v.truckCost), $2(per)],
          ['Cost per year', $2(per) + ' × ' + num(v.runs) + ' runs × ' + num(v.weeks) + ' weeks', $(total)]
        ], note: 'This counts only the run itself. The job that stopped and the billing you missed come on top.' };
      },
      fixes: [
        ['Build a truck stock list', 'List the 30 parts you use most, with how many each truck carries.'],
        ['Restock from the list', 'Restock every afternoon or Friday from the list, not from memory.'],
        ['Pre-pull parts for tomorrow', 'Look at tomorrow\'s jobs and pull the parts today.'],
        ['Order for delivery', 'Most suppliers deliver. Order the day before instead of driving.'],
        ['Count runs for a month', 'Every unplanned run goes on a tally. Watch the number drop.']],
      script: { title: 'End-of-day restock note to the crew', body: 'Before you head out: check your truck against the stock list and text me what\'s low by 3pm. I\'ll have it ordered or pulled for the morning.' },
      week: ['Tally parts runs this week', 'List the 30 most-used parts', 'Set the count for each truck', 'Print the list for every truck', 'Do the first full restock', 'Start pre-pulling for tomorrow', 'Ask your supplier about delivery'] },

    { id: 'billing-speed', code: 'billing', n: 11, name: 'The Billing Speed Leak', short: 'Billing speed', tagline: 'Invoice same day, get paid faster',
      what: 'Every day between finishing a job and sending the invoice is a day your money sits in someone else\'s bank. Invoices that go out days later get paid later, and some never go out at all.',
      why: 'Invoicing waits until the weekend or "when I get to it." Paperwork piles up, a few jobs fall through the cracks, and nobody follows up on what\'s overdue.',
      signs: ['Invoices go out days or weeks after the job', 'You\'ve found a job you forgot to bill', 'You don\'t take cards on site', 'No one follows up on overdue invoices', 'You don\'t know how much you\'re owed right now', 'Customers pay "when they get to it"'],
      fields: [F('uncollected', 'Work never billed or never collected, per month', '$', 'Forgotten invoices, small balances you let go, write-offs.'), F('daysLate', 'Days from job done to invoice sent', '#'), F('weekly', 'Revenue per week', '$')],
      defaults: { daysLate: 5 },
      prep: function (v) { if (v.weekly == null) v.weekly = Math.round(v.ticket * v.jobs); },
      calc: function (v) {
        var lost = v.uncollected * 12, stuck = v.weekly * v.daysLate / 7;
        return { total: lost, steps: [
          ['Never billed or collected', $(v.uncollected) + ' × 12 months', $(lost)],
          ['Cash sitting unbilled at any time', $(v.weekly) + ' × ' + v.daysLate + ' days ÷ 7', $(stuck)]
        ], note: 'The second number isn\'t lost, but it\'s your money working for someone else.' };
      },
      fixes: [
        ['Invoice before you leave', 'Send the invoice from your phone at the job, or the same night at the latest.'],
        ['Take cards on site', 'A card reader or pay link gets most customers to pay right away.'],
        ['Check open jobs every Friday', 'Every finished job should have an invoice. Look for gaps.'],
        ['Follow up on a schedule', 'Day 7: friendly reminder. Day 14: call. Day 30: final notice.'],
        ['Put your terms in writing', '"Due on completion" on every quote and invoice.']],
      script: { title: 'Friendly payment reminder (day 7)', body: 'Hi [Name], just a friendly reminder that invoice #[number] for $[amount] from [date] is still open. You can pay here: [link]. Thanks so much!' },
      week: ['List every job finished in the last 30 days', 'Match each one to an invoice', 'Send any missing invoices today', 'Set up phone invoicing or a pay link', 'Write your reminder texts', 'Start the Friday open-jobs check', 'Add "due on completion" to quotes'] },

    { id: 'lead-flow', code: 'calls', n: 12, name: 'The Lead Flow Leak', short: 'Lead flow', tagline: 'Missed calls are missed jobs',
      what: 'When you\'re on a job, the phone rings and you can\'t pick up. Most people looking for help don\'t leave a voicemail. They call the next name on the list. Every missed call from a new customer can be a job someone else got.',
      why: 'Owners do the work and answer the phone, so calls get missed during the busiest hours. Without a quick text-back or a system, those leads disappear.',
      signs: ['You miss calls while on jobs every day', 'Call-backs happen at night or the next day', 'You don\'t text back missed calls', 'Your voicemail is full or generic', 'You don\'t know how many calls you miss', 'You have few Google reviews compared to competitors'],
      fields: [F('missed', 'Missed calls per week', '#'), F('pNew', 'Share that are new customers looking for work', '%'), F('pGone', 'Share who call someone else instead of waiting', '%'), F('close', 'Share of quotes you usually win', '%'), F('custValue', 'What a new customer is worth in the first year', '$'), F('weeks', 'Working weeks per year', 'wks')],
      defaults: { pNew: 50, pGone: 60 },
      calc: function (v) {
        var lostJobs = v.missed * v.pNew / 100 * v.pGone / 100 * v.close / 100, total = lostJobs * v.custValue * v.weeks;
        return { total: total, steps: [
          ['New customers lost per week', num(v.missed) + ' × ' + v.pNew + '% × ' + v.pGone + '% × ' + v.close + '%', num(lostJobs)],
          ['Lost per year', num(lostJobs) + ' × ' + $(v.custValue) + ' × ' + num(v.weeks) + ' weeks', $(total)]
        ] };
      },
      fixes: [
        ['Text back every missed call', 'Set up an automatic text-back, or send the text below within 10 minutes.'],
        ['Count missed calls for a week', 'Your phone log has the number. Write it down every day.'],
        ['Block call-back times', 'Two set times a day (like lunch and 3pm) to return every call.'],
        ['Fix your voicemail', 'Say when you\'ll call back and that a text is faster.'],
        ['Get help with the phone', 'An answering service or a part-time helper can pay for itself with one saved job a week.']],
      script: { title: 'Missed-call text-back', body: 'Hi, this is [Name] at [Business]. Sorry I missed you, I\'m on a job. What can I help with? Text me the address and what\'s going on, and I\'ll get back to you by [time].' },
      week: ['Count missed calls every day', 'Write your text-back message', 'Turn on auto text-back if your phone or app has it', 'Re-record your voicemail', 'Set two call-back times a day', 'Ask 5 happy customers for reviews', 'Look at answering services and their prices'] }
  ];

  function fill(s, t) {
    if (!s) return s;
    var cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'trade') return t.short;
      if (k === 'workersCap') return cap(t.workers);
      if (k === 'slotsCap') return cap(t.slots);
      if (k === 'noshowCap') return cap(t.noshow);
      return t[k] != null ? t[k] : m;
    });
  }
  function inputsFor(leak, tradeKey) {
    var t = TRADES[tradeKey] || TRADES.general, v = {}, k;
    for (k in t.ex) v[k] = t.ex[k];
    for (k in leak.defaults) v[k] = leak.defaults[k];
    if (leak.prep) leak.prep(v);
    return v;
  }
  var api = { TRADES: TRADES, LEAKS: LEAKS, fill: fill, inputsFor: inputsFor, money: $, money2: $2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CBS_LEAKS = api;
})(this);
