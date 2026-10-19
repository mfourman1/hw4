# Usability Improvements: Campus Customs Shop + Chatbot

Four improvements: two on the front end (what shoppers see and click) and two on the
backend (the server and the shop assistant agent). The full technical write-up is in
`output/harness.md`.

| # | Where | Improvement | Why it matters |
|---|---|---|---|
| 1 | Front end | **Wishlist and shopping cart** | Helps shoppers organize the custom orders Campus Customs is best known for |
| 2 | Front end | **Custom embroidery with saved designs** | Lets shoppers personalize garments and reuse a design across several items |
| 3 | Backend | **Privacy: sensitive details hidden in chat** | Improves privacy: card numbers, passwords, and similar details are never saved or sent to the AI model |
| 4 | Backend | **Better item descriptors and smarter search** | Fixes the descriptors attached to items, so the agent finds and describes what shoppers mean |

How to check them yourself (from the `backend/` folder):

```
python evals/search_eval.py     # search test set
python evals/privacy_eval.py    # privacy test set
```

---

## Front end

### 1. Wishlist and shopping cart

Campus Customs is best known for custom orders, and those orders often involve more
than one person. The wishlist and the cart let shoppers organize them.

**Wishlist: deciding what to order, and sharing it**

- Shoppers tap the ♡ on any product to save it to their wishlist.
- A wishlist lets **someone else complete the order**, or get an idea of what the student
  wants. That might be **parents and family** shopping for a gift, or a **campus
  organization** putting together a group order.
- To share it, the shopper can:
  - **Download a PDF** with each item's photo, name, price, description, colors, and a link;
  - **Email the list.** This opens the shopper's own email app with the list filled in.
    The site itself never sends email.

**Cart: putting the purchase together**

- The cart is where the purchase gets completed. Shoppers add items in a chosen **color**,
  **size**, and quantity, with optional embroidery.
- **Nothing important gets left out of an order.** Size (and, for embroidery, the text and
  thread color) are required. If a shopper presses Add to cart without them, the missing
  choices are outlined in red with a short message ("Choose a size."), the page scrolls to
  the first one, and a summary says what's left to do.
- **Color is selected automatically.** Every item Campus Customs carries today comes in a
  single color, so the Color step shows that color already selected, with a sentence
  describing it, e.g. "This item comes in one color, selected for you: light gray with
  navy blue details." Color is shown in that one place on every product page, so the
  page never seems to offer a color it doesn't sell.
- **Ready for multi-color products.** The color choice was built so the store can carry
  products that come in several colors. If an item lists more than one color, the product
  page shows them all, selects none, and requires the shopper to pick one (highlighted if
  missing). The server only accepts colors on that item's list. This was tested by
  temporarily giving one item two colors. If the store adds such items, their stock would
  also need to be tracked by color, since today it's tracked by size only.
- The cart checks stock, so it never holds more than the shop has, and totals the order.
- **Owner decision:** online checkout and payment are **not** part of this project. The
  cart shows the estimated total, and the purchase is finished at the shop (57 Broadway,
  New Haven).

**For everyone:** guests can use both; their lists are kept on their own device.
Logged-in shoppers' lists are saved to their account. If a guest logs in, everything they
collected moves into the account automatically.

### 2. Custom embroidery with saved designs

- Shoppers can add their own text (up to 20 characters) to garments that **don't have
  large central text**. That's 39 of the 102 products: the ones with only a small logo on
  the left chest.
- They choose where it goes: **left chest (just below the existing logo), right chest, or
  the shoulder.**
- They choose a **thread color** (White, Navy, Yale blue, Gray, Black, or Gold). It's
  required, and it's highlighted if missing, just like the text.
- **Dark-on-dark warning.** If a shopper picks a dark thread (anything but white or gold)
  for a dark garment (navy or charcoal), a warning appears: "Heads up: navy thread on a
  navy garment may be hard to see. White or gold thread stands out best on dark fabric.
  You can still add it if you like a subtle look." The purchase is still allowed, since
  some people like that look, and the cart line keeps a short reminder.
- Embroidery adds **$10.00 per item** (owner decision), shown in the cart.
- **Saved designs:** the text, location, and thread color are saved, so the shopper can put
  the same design on several garments with one click. That's useful for a family set, a
  team, or a campus organization.

---

## Backend

### 3. Privacy: sensitive details hidden in chat

**Improves privacy.** Shoppers sometimes type things into a chat that a store should never
keep, like "can you put it on my card 4111 1111 1111 1111?" Before this change, that
message was saved to the shopper's chat history word for word and sent to the AI model.

- Before a chat message is **saved** or **sent to the AI model**, the server removes:
  - payment card numbers;
  - card security codes;
  - Social Security numbers;
  - passwords;
  - bank account and routing numbers;
  - phone numbers.

  Each is replaced with a note like "[card number removed]".
- The shopper sees their message the way it was saved, with a short note: "For your
  safety, we removed the card number from your message. Please don't share it in chat."
  The assistant also reminds them, and helps with the rest of the message.
- Chat history saved before this change is checked and cleaned every time the server
  starts.
- **Test set:** 15 messages with sensitive details (all removed), 12 ordinary shopping
  messages like "How much is the $68 hoodie?", "I need 2 in XL", "Class of 2027" (all left
  unchanged), and a check that cleaning a message twice changes nothing.
  **42/42 checks pass.**

Example from the live site:

> Shopper typed: "Can you put this on my card 4111 1111 1111 1111? Text me at 203-555-0142…"
> Saved and sent to the AI: "Can you put this on my card [card number removed]? Text me at [phone number removed]…"

### 4. Better item descriptors and smarter search

**Fixes some of the descriptors attached to the items**, so the shop assistant finds and
describes products correctly.

- **Placeholder items fixed.** Three products had placeholder text ("Vision blocked")
  instead of a real description, no colors, and generic garment types: the Benjamin
  Franklin T-Shirt, the Berkeley Sweater Fleece Jacket, and the Timothy Dwight College
  Crewneck. All three now have a real description, colors, search tags, and garment type,
  written from the product photos. The quarter-zip that was named "School Of Architecture
  Crewneck" keeps its corrected name. These fixes are applied automatically when the
  server starts, so a fresh copy of the database gets them too.
- **Consistent garment types.** The catalogue labels the same kind of item many ways
  ("short-sleeve t-shirt", "short-sleeve T-shirt", "t-shirt"; "hoodie", "pullover
  hoodie", "hooded sweatshirt"). Search now groups them into clear kinds: T-shirt, hoodie,
  crewneck, quarter-zip, jacket, fleece, long-sleeve, sweatshirt.
- **Understands how shoppers talk:** "tee", "tshirt", "hoody", "1/4 zip", "hooded
  sweatshirt", "grey" vs "gray", "mother"/"father".
- **Colors described correctly.** A product's color list is every color on that one
  garment (body, trim, crest), not a set of options. The assistant had been saying a
  heather gray fleece was "also available in charcoal gray and red". It now describes one
  colorway: "navy blue with white YALE lettering".

**Test set:** shopper searches, with the right answers taken from the catalogue's own
labels.

| | Before | After |
|---|---|---|
| Cases passing (original 19) | 13 / 19 | **19 / 19** |
| Average recall (right products found) | 82% | **100%** |
| Average precision (top results right) | 83% | **100%** |
| "tees" | 6 of 25 T-shirts | **25 of 25** |
| "hoody", "tshirt" | nothing found | **all 27 hoodies / all 25 T-shirts** |
| "grey hoodie" | navy hoodies on top | **gray hoodies on top** |

Three more cases ("bulldog", "long sleeve shirt", "gray fleece") were added afterward; all
22 pass.
