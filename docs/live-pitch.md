# Cake Slice Factory – Live Pitch and Responsibilities

Cake Slice Factory · Live edition

## The bakery that keeps its own books

*A simple pitch – and a plain-English map of what handles what.*

Prepared 22 October 2026 · Live Supabase system · Owner and staff access

## The 12-year-old pitch

Imagine your bakery has a robot helper.

It remembers every cake you sold, every naira that came in, every bag of flour in the store, and every cake still in the oven. It also stops you from accidentally selling a cake you don't have, or letting the wrong person change the prices.

That's this app.

It is basically a bakery video game – except the cakes are real and the money matters.

You open the dashboard and see how much money came in today, how much you still need to collect, which cakes are running low, what needs baking, what you spent, and whether your stock numbers actually match reality.

You click **New order**, pick a customer, add a cake, take a deposit, and the app handles the rest: the receipt number, the balance, the stock, the status, the history, and the report at the end. The **calendar** shows what is due each day. The **delivery board** shows what is ready, who is taking it, and where it is going. The **payments page** is the money jar. The **documents page** is the filing cabinet. The **quotes page** keeps the maybes from getting mixed up with confirmed work.

Need to send a list to your accountant or keep a copy? The main working lists can be downloaded as **CSV, Excel, Word or PDF**, or printed on paper. You are never trapped inside the screen.

The important bit: this is not a pretty page sitting in front of a spreadsheet. The rules live in the database. The screen is the shop counter; the database is the warehouse manager, security guard and accountant rolled into one.

### One cake's journey

| Step | What happens | What the app does |
| --- | --- | --- |
| 1 | Ada asks for a cake | The app saves the customer, cake, price, deposit and due date as one order. |
| 2 | The kitchen bakes | Production uses the recipe, consumes ingredients and adds finished cake stock. |
| 3 | The cake is ready | The order moves to ready. The calendar and delivery board show what leaves today. |
| 4 | The cake is collected or delivered | The order moves to completed. Stock goes out once – not twice, even if someone clicks again. |
| 5 | The money is checked | Payments and refunds update the balance. The database does the arithmetic. |
| 6 | The day is closed | Reports show sales, cost of goods, profit, cash collected and what is still owed. |

And because it is a bakery, not a toy, there is a boss mode. The owner sees money, reports, staff, settings, audit logs and the recycle bin. Staff can take orders and do the day-to-day work, but cannot wander into the owner's office.

> “The books finally match the fridge.”

## The shop floor: what each section is for

The sidebar is grouped by the work, not by the database. It now covers the full trip from an enquiry to a delivered cake and a reconciled payment. On a phone it opens as a drawer with a clear close button; on a desktop every label stays visible, so nobody has to guess what an icon means. A light/dark switch sits in the top bar.

| Section | What it answers |
| --- | --- |
| **Dashboard** | How are we doing today? What needs attention? |
| **Orders** | What has been confirmed, baked, collected or cancelled? |
| **Quotes** | Which enquiries are still waiting for a yes? |
| **Payments** | What came in, by cash, transfer or POS, and who still owes us? |
| **Documents** | Where is that quote, invoice or receipt I issued? |
| **Customers** | Who buys from us, what do they spend and when did they last order? |
| **Products and Ingredients** | What do we sell, what is in stock and what is running low? |
| **Recipes** | What does each cake really cost to make? |
| **Vendors** | Who supplies us and what do we owe them? |
| **Production** | What is baking, what was wasted and what stock did it use? |
| **Calendar** | What is due this month, this week and today? |
| **Deliveries** | What is ready to dispatch, who is riding and where is it going? |
| **Purchases** | What did we order from suppliers and what arrived? |
| **Expenses** | What did we spend, on what, and do we have the receipt? |
| **Reports** | Sales, profit, cash-up, product performance and restocking. |
| **Admin** | Settings, team access, audit trail, trash, notifications and backup. |

## Who handles what

Every job has one clear owner. This is the part that keeps the app honest when the screen, the network or a person makes a mistake.

| Job | Handled by | What that means in the bakery |
| --- | --- | --- |
| The front door | Supabase Auth | Checks the email and password, creates the session and sends password-reset emails. No custom password store is kept in the app. |
| Who can do what | Postgres Row Level Security, plus interface checks | The owner gets the office keys. Staff get a working badge. The restriction is enforced by the database, not just by hiding a button. |
| The memory | Supabase Postgres | Customers, orders, payments, products, ingredients, recipes, stock movements, expenses and settings all live in one live database. |
| The rule robot | SQL functions and triggers | Recalculates totals, validates discounts, writes status history, applies stock movements and blocks edits to records that must stay frozen. |
| Money maths | Postgres `numeric(14,2)` and total triggers | Prices, deposits, balances and refunds are calculated from the saved records – not trusted from a number typed into the screen. |
| Saving an order | `create_order()` database function | Saves the order and all its cake lines together. If one part fails, the whole order fails. No half-saved sales. |
| Stock control | Append-only stock ledger and triggers | A one-way CCTV tape. A completed order deducts stock once; a cancellation reverses it once. Every movement remains visible. |
| Receipts, quotes and invoices | `issue_document()` snapshots | Creates a numbered document with the prices at that moment. Later price changes cannot rewrite an issued document. |
| Payments ledger | Payments table and `recalc_order_paid()` trigger | Every deposit, balance payment and refund updates the order balance. The payments page shows the full history and outstanding debtors. |
| Calendar and deliveries | Orders with due dates and delivery details | The calendar groups work by due date. The delivery board groups it by run date, address and rider, and moves the order from ready to dispatched to delivered. |
| Errors and validation | Friendly app messages, plus database constraints | The interface explains problems in plain language. The database is the final referee and refuses invalid writes even if the interface is bypassed. |
| Files and receipts | Supabase Storage, private bucket `cake-files` | Stores expense receipts and order attachments. The app creates short-lived signed links instead of exposing files publicly. |
| Mailing and messaging | Supabase Auth email; WhatsApp links; print and PDF layouts | Supabase handles account and password-reset emails. Quotes and invoices are shared by WhatsApp, printed, or downloaded as PDF. The app does not automatically email invoices and has no separate mail server. |
| Reports and exports | SQL views, JavaScript tables, CSV, Excel, Word, PDF and print | The scoreboard for sales, profit, cash-up and restocking. Every list opens an export chooser so the same data can become a spreadsheet, a Word document, a PDF or paper. |
| Notifications | Database triggers and app refresh | Low-stock and attention alerts are written as notification records and refreshed in the app. They are not push notifications to a phone. |
| Audit trail and recycle bin | Audit triggers and soft delete | The diary records who changed money or stock. Deleted records go to trash first, so mistakes can be restored before they are purged. |
| Hosting and delivery | Static files plus Supabase | The HTML, CSS and JavaScript can be served by any static host. Supabase supplies the database, login, storage and security. |

## Downloads that fit the job

The export chooser is shared across reports, payments, documents, deliveries, the calendar, customers and the catalogue. It does the same work everywhere, so nobody has to learn five different buttons.

| Format | Best for | How it is made |
| --- | --- | --- |
| **CSV** | Importing into another system or a quick spreadsheet | Plain text with a strong header row. |
| **Excel (.xls)** | Owners and accountants who want a formatted workbook | SpreadsheetML generated in the browser. |
| **Word (.docx)** | A readable report to edit or attach to a message | A real Word document with a branded table. |
| **PDF** | Sending to a customer or keeping a fixed copy | Generated in the browser, with page numbers. |
| **Print** | Paper at the counter or “Save as PDF” from the printer dialog | A clean print layout with the sidebar and buttons removed. |

PDF and Word use a one-time document engine loaded from a CDN. If that engine cannot load, the app falls back to a print-ready file so the owner is never stuck. The data never leaves the browser for these exports.

## What is now live-only

The project has been stripped back to the real system. There is no local pretend database and no sample business to explore.

| Area | Current behaviour |
| --- | --- |
| Database | The app connects only to Supabase. If the URL or anon key is missing, it shows setup instructions instead of opening a local fallback. |
| Accounts | The first account can claim ownership once from the sign-in page. Later accounts start as staff, and an owner promotes them when ready. The database refuses a second owner claim. |
| Business data | The database starts with the settings row and no customers, products, orders or fake history. The owner builds the real catalogue. |
| Removed tooling | The browser database, local session store, sample data file, sample accounts and reset button have been removed. |
| Kept for confidence | The SQL regression suite and the stock-integrity check remain. They test the real database and roll back their own fixtures. |

## How to go live

1. Create a Supabase project.
2. Run `supabase/schema.sql`, then `supabase/002_core_additions.sql`, then `supabase/003_owner_setup.sql` in the SQL editor.
3. Put the project URL and anon public key in `js/config.js`.
4. Serve the folder with `node tools/serve.js` and open `http://localhost:5173`.
5. Choose **Create owner account** on the sign-in page. The first account becomes the owner. If email confirmation is on, confirm the email and sign in; the claim finishes automatically.
6. Add staff by letting them sign up normally, then promote them in **Admin → Users & roles**.
7. In Supabase Authentication → URL Configuration, set the Site URL and add your local and production addresses.
8. Confirm the private storage bucket `cake-files` and its storage policies exist.
9. Build the real product, ingredient, recipe and customer catalogue, then start taking orders.

## What the live app covers

| Sales | Money | Control |
| --- | --- | --- |
| Quotes, confirmed orders and the full fulfilment pipeline; walk-in, Instagram, WhatsApp and phone channels; deposits, balances, refunds and discount reasons; quotes, invoices and receipts; payment ledger by method and outstanding debtors; order calendar and delivery dispatch board | Expenses with receipt upload; revenue, COGS, gross and net profit; cash-up, outstanding balances and restocking; CSV, Excel, Word, PDF and print exports; full JSON backup | Owner and staff permissions in the database; audit trail and recycle bin; immutable financial documents; integrity checks for stock; labelled mobile-first navigation grouped by the work; light and dark themes |

## Honest boundaries

- **No automatic invoice email.** Supabase sends account and password-reset emails. Quotes and invoices are shared by WhatsApp, printed, or downloaded as PDF.
- **No scheduled cloud backup.** The owner can download a full JSON snapshot from Admin → Data & integrity. Database backups are controlled in Supabase.
- **No phone push notifications.** Notifications are database records refreshed in the app.
- **No offline write queue.** The app warns when the connection is down; writes need the live database.
- **Uploads need the private storage bucket.** The schema sets up the database side; confirm the `cake-files` bucket and storage policies exist in the Supabase project.
- **PDF and Word need the document engine once.** If the CDN is blocked, the app prints instead. The data is not uploaded anywhere.

In one sentence: Cake Slice Factory is a live bakery control room – the screen takes the order, Supabase remembers it, and the database rules make sure the cake, the cash and the stock all tell the same story.

Cake Slice Factory · Live system pitch and responsibility map · 21 October 2026
