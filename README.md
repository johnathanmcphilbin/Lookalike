# Lookalike

A little computer vision project that learns to recognize things from photos you take.

You train it on your own images and then use your webcam to see if it can recognize what you taught it.

This is my first YSWS project with Hack Club.

## About me

Hey, I'm Johnathan. I'm a student from Ireland, and this is my first YSWS project with Hack Club.

I've been wanting to learn more about computer vision, so I decided to make something simple and see how far I could get with it.

## What is Lookalike?

Lookalike lets you train an image classifier to recognize your own stuff.

You could teach it to recognize:

* Your pets
* Different objects
* Your cards
* Your friends
* A messy vs clean desk
* Rock, paper and scissors
* Pretty much anything you can take pictures of

The idea is that you don't need some massive dataset from the internet. You take the photos yourself and train the model on those.

## How it works

The model is made using **Google Teachable Machine** and exported as a **TensorFlow.js** model.

The website then:

1. Gets permission to use your webcam
2. Loads the trained model
3. Sends webcam frames to the model
4. Gets back a prediction
5. Uses that prediction to actually do something on the website

Everything runs in the browser.

There isn't a server sitting somewhere processing the camera feed.

## The important part: make it do something

Getting a prediction on the screen isn't really the end goal.

**You need to connect the prediction to something that happens.**

For example, you could train the model to recognize:

```text
Something white
Something black
```

Then make your website switch between **light mode and dark mode** depending on what the camera sees.

Or you could:

* Show a different GIF
* Change the background
* Change the text on the page
* Play a sound
* Make an animation happen
* Show a different image
* Turn an LED on
* Move a servo
* Change the entire website layout

It doesn't have to be complicated.

For example:

**Camera sees a banana → website turns yellow**

**Camera sees a specific card → card information appears**

**Camera sees your hand → a button gets pressed**

**Camera sees something dark → website switches to dark mode**

The computer vision model is what decides what is happening. Your code decides what happens because of that prediction.

That's the part you actually need to build yourself.

## Making your own model

If you want to use Lookalike with your own thing, you can make a model pretty quickly.

### 1. Pick a few things

Choose 2 to 4 classes.

For example:

```text
Biscuit
Cake
```

### 2. Take some photos

Take around 30 to 50 photos for each class.

Try moving the object around a little and taking the photos from different angles. If every photo looks exactly the same, the model probably won't work very well when you move the camera.

### 3. Train it

Go to [Teachable Machine](https://teachablemachine.withgoogle.com/) and create an Image Project.

Add your classes, upload your photos and press train.

You can test the model with your webcam right there.

### 4. Export it

When you're happy with the model, export it as TensorFlow.js.

This gives you a `model.json` file and some model weight files.

Put those into the project.

### 5. Connect the prediction to your idea

This is where you actually write some code.

The webcam and model loading are already handled. You need to take the prediction from the model and use it to make something happen.

For example:

```javascript
if (prediction === "Dark") {
    document.body.classList.add("dark");
} else {
    document.body.classList.remove("dark");
}
```

That's enough to make your computer vision model control the website's theme.

You can make this as simple or as weird as you want.

### 6. Test it

Run the website and try showing it the things you trained it on.

Make sure the reaction actually happens.

If the model keeps getting something wrong, go back to Teachable Machine, take some more photos and train it again.

## Demo

The important part is showing that the model actually does something.

Record a short video, around 20 to 30 seconds, showing:

1. The project running
2. Your webcam turned on
3. You showing the thing you trained it to recognize
4. The prediction changing
5. The thing you coded happening because of the prediction

For example, if your project switches between light and dark mode, show the camera recognizing each class and the website actually switching modes.

Don't just record the Teachable Machine training screen or a confidence number going up and down.

We want to see the finished project reacting to the camera.

### Uploading the demo

Upload your recording to YouTube.

Set the video to Unlisted rather than Private.

An unlisted video doesn't appear in search or on your channel, but anyone with the link can watch it.

In YouTube Studio:

1. Upload your video
2. Go to Visibility
3. Select Unlisted
4. Save the video
5. Copy the video link
6. Put the link in your submission

Don't use Private if the person reviewing your project needs to open the link. Private videos require specific viewing access.

You can make it public if you'd rather.

## Running locally

Clone the repository:

```bash
git clone <your-repo-url>
cd lookalike
```

Then start a local server:

```bash
python3 -m http.server
```

Open the address shown in your terminal.

You'll need to allow the browser to access your webcam.

## Tech

* HTML
* CSS
* JavaScript
* TensorFlow.js
* Teachable Machine
* Webcam API

That's pretty much it.

##
