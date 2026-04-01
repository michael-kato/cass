This is a website for Cascade Action Shooting Sports. 

We are going to recreate this website from images of the existing website. The new website will be hosted on Cloudflare, from a github repository, and I'm told from google gemini that we should use 


The images and videos that power the current website are included in the asset folder. Each folder also has one or more images called "reference" or similar that are screenshots of the original webpage.

The html files are empty, and should map to the asset folder of the same name plus "_files".

All pages share the same navigation header, and footer. 
All pages have roughly the same styling. 


Here are descriptions of some of the more advanced content that I don't think the images will convey well.


Home: First large image directly under the banner is a slideshow for a welcome image and a current event sign up link. The images slowly move in the background. The slideshow transitions every ~5 seconds.

Scrolling down there some text and image side by side. 

Below that is am embedded video or gif of some dynamic shooting. Borderless, no controls, looping.

Scrolling down, the CASS Products load in dynamically, probably so the page loads faster. There are highlights of the latest items in the merch store.

Below that is a side by side set of images below a link to the matches page. 

Below that are the latest posts from the CASS instagram, two rows of 5 images. With a load more button to see more. 

Footer.



Events: This page is sortable and searchable for all the upcoming CASS events. The events can be anywhere in the USA so they should be clearly distinguishable. Clicking on a card pops up the details for the event. I'm thinking we have a backend JSON file to populate these cards but I'm still chewing on the concept. 

Below those cards are some "community events". Related to CASS but not officially CASS events. 


FAQ: This page has a very interesting element, which is a sample match booklet that is fully rendered in 3d and has controls to flip through the pages of the match book. I have no idea how we will recreate this. I'll ask the customer about how it was done in Shopify. 



Partners: This page shows all the venues nationwide where CASS events are held. 
It features an interactive map with a searchable list of venues that includes addresses. 

Below that is an embedded video