# AI Prompts — Homework 4

Log of the prompts I typed to my vibe coder (Claude Code) for each problem, in my own words. Each follow-up is followed by one sentence on what was lacking after the previous prompt.

---

## Problem 1: Vibe coder prompts

**Prompt:**

> This homework will use a series of problems. Problem 1 is to create AI_prompts.md, which will be a log of whatever I type into the coder for this project. Each section should include the problem number and title, at least one typed prompt in my own words as much as possible, and one follow-up prompt if needed (with a sentence on what was lacking after the first). This should look a lot similar to Homework 3

**Follow-up:** None needed.

---

## Problem 2: Analyze the database

**Prompt:**

> For problem 2, download data.zip (link on https://zlisto.github.io/mgt_409_fa26/hw4/p2.html) unzip into the Homework 4 folder. Show me data/campus_customs.db

**Follow-up:**

> For catalogue, the table holds the product id for the product (which links it to inventory), the name of the product, what overall type of garment it is (for example a hoodie or t-shirt), and two descriptive fields such as the color and specific tagging that might come up in a search request. An image of the garment is included, and the price
>
> For inventory, the product id is linked to catalogue and says how much of each size of the garment is in stock.
>
> Users is to house who is buying garments off of the site, with a password and contact information.
>
> chat_messages is a record of user interactions with the chat bot, including the content of the messages and what products it referred to.

*What was lacking:* The first prompt only showed me the database in chat; my own understanding of each table and why its fields matter was not written into output/harness.md yet.

---

## Problem 3: React + Vite front end and FastAPI backend

**Prompt:**

> For Problem 3, we are going to scaffold a React + Vite + TypeScript front end for Campus Customs. There will be a nav bar at the top that links to the main pages (Home, Products, About Us, Log in, Create account).  I want you to pull the customs-style wording from yalebulldogblue.com for Home and About Us but these pages should be in my own voice (not copied).
>
> The Products page shoudl show product images from the catalogue (use the images paths in the database) with basic product info (name, price, short description).
>
> Each product opens a single-item page (large image on one side, full product text on the other - description, price, sizes/stock if available). Clicking a card on products should take the shopper there.
>
> There should be a chat interface on the bottom right of the site (ok for a floating chat panel). This will eventually talk to an agent, but for now include a stub that will eventually call to my backend.
>
> Start a FastAPI app in backend/main.py to serve products and images. I will eventually grow this into the agent backend.

**Follow-up:** None needed.

---

## Problem 4: Create account and login

**Prompt:**

> Problem 4 is to create the account and login. I want the create account to include the user's first name and last name in separate fields, email, password (with a confirm password field). The login should just ask for the email and password. New accounts go into the users table. Please make sure that the fields match. Passwords should be stored securely using salt.
>
> We are going to test the seed database with the user test@campuscustoms.yale.edu when this is done. I want to include in output/harness.md how auth works. Specific points should include that the user typed password is un-hashed rather than the stored password, the salt is read out of the stored string (the middle piece), the typed password is hashed with that same salt, then compared with the stored hash. There is a constant-time compare. Signup and login must use the same hash settings or otherwise the right password will not match, and we will use both the stored and a brand new account to check that this works.

**Follow-up:** None needed.

---

## Problem 5: Agent backend for the shop chatbot

**Prompt:**

> For Problem 5 we are going to create the PydanticAI agent backend for the shop chatbot. This will be behind FastAPI, plugged into my front-end chat widget. The API app should be in backend/main.py, which is the file that will be run with Uvicorn. The agent will be the following 4 files (same style as Homework 3), backend/prompts/prompt.md for system prompt, backend/agent.py for agent entry/wiring, backend/tools.py for tools the agent can call, and backend/models.py for the Pydantic/PydanticAI structured types.
>
> main.py will expose a chat route so a message from the website returns a reply from the agent. Please use the same API key that I used in Homework 3.
>
> Please put Campus Customs voice and safety basics into prompts/prompt.md, which will be expanded later. Start or update types in models.py for chat replies / product cards as needed.
>
> Please write in output/harness how the front end talks to FastAPI and how the agent is loaded (prompt file + model).
>
> The backend should run from the backend/ folder like this: uvicorn main:app --reload --port 8000

**Follow-up:**

> Yes, add Python's Scripts folder to my user PATH so the uvicorn command works.

*What was lacking:* The backend worked, but the plain `uvicorn` command from the problem didn't run on my computer because Python's Scripts folder wasn't on my PATH.

> everything is now closed. Retry

*What was lacking:* After the PATH change I had to close my open terminals, so the uvicorn command needed to be run again to confirm it worked.

---

## Problem 6: Lookup tools for description, price, and stock

**Prompt:**

> For Problem 6, we are going to add tools to the agent that allows it to look up real information from campus_customs.db. These will be product description, price, and how many are in stock (by size when the customer asks). The agent must use the database. It must not invent prices or quantities. It must tell the user if a specific size is out of stock.
>
> We will expand prompts/prompt.md so the agent knows to call these tools for price and stock questions. Add or update return types in models.py .
> Tell me which model fields were chosen for each tool

**Follow-up:**

> Please update output/harness.md with the tools and why the model fields were chosen for each tool. In particular, emphasize that for search products we were looking for specific characteristics of the garment that the user is looking for, get_product_description recslls information about specific garments, get_price pulls the cost of that garment, and check_stock confirms that the selected garment and size is available

*What was lacking:* The harness listed the tools and fields, but it didn't explain each tool's job the way I think about it, from finding a garment to confirming it's available in the right size.

---

## Problem 7: Chat search that updates the page

**Prompt:**

> For Problem 7, we will be adding a chat search that updates the page. When a customer asks about a type of item, such as "what hoodies do you have", the agent should search the catalogue and the website should dynamically show those matching items as product cards (image, name, price, short info).
>
> When the dynamic product cards are loaded in this way, the same single-item behavior built in Problem 3 should still work. Each product card, including the ones the chat just put on the page, should still open that detail view (large image + full info) when clicked.
>
> Update prompts/prompt.md and output/harness.md so it is clear how search results reach the page

**Follow-up:**

> Please correct this name

*What was lacking:* Testing the quarter-zip search showed that one quarter-zip was mislabeled "School Of Architecture Crewneck" in the database, so I asked for the product name to be corrected.

---

## Problem 8: Customer memory and page context

**Prompt:**

> Problem 8 is for customer memory. When a shopper is logged in, I want their chat history saved in the database in an appropriate table and reload it when they return. The agent should know who is chatting (name, email), put that in the agent deps or an equivalent clear pattern and/or tools the agent can call.
>
> Also, pass enough page contact that if someone is on a product page and asks "do you have this in pink", the agent knows which item they mean. Put this code into the agent context.
>
> I want guests to be able to chat as well, not just logged in users, but the history has to persist only for logged-in users.
>
> Document in output/harness.md how the user chat history is stored, what customer fields the agent sees, and how page context is passed

**Follow-up:** None needed.

---

## Problem 9: Usability improvements

**Prompt:**

> For Problem 9, we have to make some usability improvements. Two front-end, two backend.
>
> For the front-end, I'd like to do the following:
>
> 1. Make two options for the user to save their preferred products. The first is a wishlist that they can make to store products they're interested in and may want to buy later. This wishlist should have a share function where it can be exported in a pdf format (with pictures and description) or e-mailed to someone else (do not send e-mails in this project). The second is a shopping cart that the user can put items they want into. We will not be building check out functionality including payment in this project. Please note this in harness.md as my decision
> 2. I want the option for users to embroider certain products, specifically those that do not have large central text. I want their options to be either on the left chest, right chest, or the shoulder. I want their preferences for text and location  saved so if they want to use the same embroidery design for multiple garments they can do so
>
> For the backend, can you please recommend some improvements for accuracy, safety or speed?

**Follow-up:** (answers to the AI's two questions before it built the embroidery feature)

> Left chest = below the logo
>
> $10 per item

*What was lacking:* Every product without large central text already has a logo on the left chest, and there was no embroidery price, so the AI asked me how left-chest embroidery should work and what to charge.

> Build recommendations 1 and 2: hide sensitive details in chat, and smarter product search with a test set.

*What was lacking:* The AI recommended backend improvements but hadn't built any yet, so I picked the two I wanted. (I sent this by clicking a quick-reply button in the coder.)

> As we're working on the front end and as you're building the backend, I want you to also make output/usability.md that talks about what I added to the front end and the backend.
>
> Specifically, the front end improvements of a wishlist and a cart allow for users to better organize the custom orders that Campus Customs is best known for. A wishlist allows others to complete the order or to get an idea of what the student wants (either their parents/family or campus org) and the cart permits the completion of that purchase.
>
> The backend improvements should include notation that they improve privacy and fix some of the descriptors attached to the items.
>
> Once this is created, please complete the prior prompt

*What was lacking:* There was no output/usability.md explaining the four improvements and why they matter in my own terms: custom orders, family and campus organizations, privacy, and item descriptors.

> A few additional changes. When I try to add an item without a size to my cart, it won't let me but it doesn't tell me why. Highlight the missing fields that prevent the item from being added to the cart. Also, I noticed that the user does not need to select a color for an item for it to be added to the cart. This needs to be fixed.

> Confirm the item color, Embroidery thread color *(my answer when the AI pointed out that each product comes in only one colorway and asked what the color requirement should be)*

*What was lacking:* When I tried the cart, adding an item without a size gave me no clear reason it failed, and an item could be added without choosing a color. Embroidery also had no thread color.

> The color selection still does not match. For example http://localhost:5173/products/champion-reverse-weave-crewneck, which says that it only comes in Light Gray, yet above it both light gray and navy are listed. This needs to agree here and on any other item

*What was lacking:* The product page listed the colors on the item (like the navy lettering) above the new Color step, so it looked like navy was an option even though the item only comes in light gray.

> On further survey, there does not appear to be any currently available item for which multiple colors are available. Please set it so that items that come in a single color have that color autoselected, and include in usability.md that the option was made available should the store decide to carry products that come in multiple colors.
>
> Also, for embroidery, if the user selects a dark embroidery color (any but gold and white) for a dark (such as navy) colored garment, a warning should come up that the dark color of the embroidery may make it hard to see on the dark fabric. Purchase should still be allowed (some people actually like this), but that warning is important.

*What was lacking:* Shoppers had to click the only available color on every item, which added a pointless step, and nothing warned them that dark thread on a dark garment may not show up.

---

## Problem 10: Redesign the website

**Prompt:**

> For Problem 10, we will redesign the website. First, I want the styles, colors, hierarchy, motion, product presentation and chat feel to be like https://www.campuscustoms.com/
>
> Second. When the chat bot appears or is opened, I want a bulldog to appear over it that looks like this https://yalebulldogs.com/images/2025/3/6/Kingman.jpg?width=300. I also want the chat to start the first interaction of each session with "Boola Boola!". Don't repeat this in further chats during the same session.
>
> I want you to make a size chart on the front page based on sex and product, similar to what they have, but not a replica.
>
> For transitions, I want an emphasis on fades and smooth changes. I don't want it to look like the site is loading when the user clicks.
>
> Write output/design.md to highlight these changes. My reasoning for them is to give the user an immersive Yale experience and the feeling of being on a single page website despite transitioning between pages.

**Follow-up:**

> Some further style changes. In the headers, I want people to be able to select college-specific merchandise, sport-specific merchandise, graduate school-specific merchandise and parent/family-specific merchandise. Make this a second row of headers under the currnet ones

*What was lacking:* The header only let shoppers browse by garment type, not by who the gear is for (their college, team, graduate school, or family member).

> For the Handsome Dan picture above the chat, rather than using his specific photo, make that into a caricature and use that instead

*What was lacking:* The chat showed Handsome Dan's actual photo, and I wanted a drawn caricature of him that fits the site's style better.

> Change the caricature to look happier, and add a tongue. Also, the "Boola Boola" that I added to the chat earlier is now gone

*What was lacking:* The caricature looked too serious and had no tongue, and "Boola Boola!" only appeared the first time the chat opened in a browser tab, so after that the chat no longer started with it.

> Put the tongue to the side,  like this https://images.fineartamerica.com/images/artworkimages/mediumlarge/2/happy-bulldog-karen-williams.jpg

*What was lacking:* The tongue hung straight down from the middle of the mouth, not lolling out the side like a happy bulldog's.

> Write output/design.md to say what changed and why customers should stick around and buy. It should be concrete and short

*What was lacking:* design.md had grown into a long technical write-up (color tables, animation timings, file lists) that didn't clearly say why each change would keep customers on the site and get them to buy.

> Are there any other innovative ways to make the site better for customers?

*What was lacking:* The redesign improved the look and feel, but I wanted ideas for new features that would help customers beyond what we had already built.

> Please build all of these, including the additional options. I also want to have an option to let the user "view themselves" in the garment in the mobile edition by taking a selfie and having the garment added

*What was lacking:* The AI only suggested the features (embroidery preview, a wishlist link family can buy from, in-stock alternatives, sizing help in the chat, group orders, a seasonal Home page, and complete the look); none were built, and there was no way for shoppers to see themselves in a garment.

> On the main page, it looks like the family weekend on the banner is shifted downward so the link looks cut off. Can you please fix?

*What was lacking:* The banner kept a fixed height, so the long Family Weekend title pushed the "Shop family gear" button down to the bottom edge, where it was cut off and ran into the slide controls (on phones the photo was cut off too).

---

## Problem 11: Site testing

**Prompt:**

> Problem 11 is for site testing. Test the site live and document it in output/app_check.html. Include clear screenshots and short captions for:
>
> 1. Chat checking the inventory level of an item (honest stock/price from the DB)
> 2. The dynamic search-result cards appearing after a category question (e.g. hoodies)
> 3. The shopping cart feature added in Problem 9
>
> app_check.html should be easy to grade: heading for each check, screenshot, one or two sentences on what the screenshot proves. Put the screenshot image files in output/app_check_images/ and link them from app_check.html with relative paths (for example app_check_images/inventory.png)

**Follow-up:** None needed.

---

## Problem 12: Audit trail, safety, and finishing the harness

**Prompt:**

> For Problem 12 we need to do an audit trail, safety, and finish harness.
>
> To start, can you recommend safety rules for the agent?

**Follow-up:**

> Can you write what these rules are?

*What was lacking:* The AI said it had recommended nine new safety rules, but it never actually listed them, so I couldn't choose which ones to build.

> Please build all of them as written here.
>
> Also, keep an append-only output/audit-trail.json of agent-loop activity (time, tool name, short args/result, stop reason). Do not wipe it between runs.
>
> Finally, finish output/harness.md so it is clear how the system works. Where I've provided justification in my own words, use that as a basis for your response
>
> * Model fields in models.py and why you chose them
> * Tools and abilities
> * Safety rules
> * Specs (loop limits, result caps, models, how to run front + back)

*What was lacking:* The safety rules were only a list of recommendations, nothing recorded what the agent did on each turn, and harness.md was organized problem by problem instead of explaining the finished system in one place.

---

## Problem 13: Push to GitHub and submit the URL

**Prompt:**

> For Problem 13, I am able to use the exact question from the problem set. Please do the following using my linked GitHub account https://zlisto.github.io/mgt_409_fa26/hw4/p13.html

**Follow-up:** None needed.

---
