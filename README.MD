## Inspiration 🤯🤯
How many times have you gone to throw away a paper towel, aluminum can, or plastic water bottle, and thought "Wait, does this really go here?". That's the concept that inspired EcoDepot. The idea is to have a trash can/recycling bin all in one. Humans can be careless, thoughtless, and are very prone to making mistakes, this is why even the most eco-minded person can make mistakes in the waste management/recycling process. To combat this, we have implemented machine learning and computer vision to automate the process with robotic accuracy.

We also realize that not all people have the environment in mind. This is why we also wanted a way to encourage all people to recycle through EcoDepot. We took #9 and #12 of the United Nation's Sustainable Development Goals (Industry, innovation, and infrastructure, and Responsible consumption and production) in mind to encourage growth in the recycling community.

## What it does🔨🛠️⚒️
EcoDepot is a smart recycling bin that also provides rewards and incentivizes recycling for everybody, even those that aren't eco-minded. EcoDepot works by using computer vision to identify the type of trash or recyclable that is tossed onto the chute. The bin will then rotate to the correct compartment, and deposit the trash or recyclable.

In addition to smart recycling, we also provide a monetary incentive to our users. By using computer vision to scan a student's ID, they are able to log into their EcoDepot account in seconds. Upon logging into a session, they can access a dashboard with their account information, including bottle transaction history. Additionally, any refundable bottles or cans they deposit during this session will result in a monetary incentive in their account. This is possible thanks to the large mandatory bottle deposit charged in BC, where returning the bottles can make EcoDepot a profit. 

## How we built it 👷👷‍♂️👷‍♀️

EcoDepot is an amalgamation of different technologies that come together in a system to achieve our goal. EcoDepot's activity can be categorized into 5 types of exciting hacks: Machine learning, Computer vision, Electronics, user interface, and user processing. We first use computer vision to recognize a student ID, this logs the student into our system where they can see account information and access their dashboard. We then trained a TensorFlow machine learning model to recognize different recyclables for sorting via computer vision and uses a hybrid system that uses artificial intelligence to verify our results. A microcontroller is then fed information from the vision model to correctly position the bin to intake the identified waste/recyclable. 

## Challenges we ran into🛣️🛣️

As a project with a lot of hardware demands, we ran into many issues involving supplies and power restraints. Our 9V battery died in the middle of the night, we ran out of female-female wires, forcing us to use one less motor, just to name a few. In addition to supply challenges, the majority of the parts we used for this project were 3D printed. In a situation with strict time constraints, this posed a challenge in terms of our design parameters, as well as durability risks to our project. 

In terms of software challenges, we couldn't retrieve student information directly from the magnetic stripe native to the student ID as that required data and hardware that we did not have access to. Our workaround for this was to use computer vision to identify the barcode on the student ID and create our own login system using this barcode as a UUID. 

## Accomplishments that we're proud of ✨✨

Due to our team's diverse skill set, we each tackled tasks that we were confident in, giving us several individual working parts of a system. Thanks to great collaboration, communication, and teamwork in our team, we were able to integrate these parts into a functioning system very swiftly, contrary to expectations.

Our team also combined a large variety of technology into one application. We applied cutting edge technology such as machine learning and computer vision, while also integrating timeless mechanisms like microcontrollers and web development. 

## What we learned🏫🏫

Each of us worked with the rest of the team as a whole, forcing us to learn technology that we were not familiar working with, and integrating it with what we were comfortable with. Matthew learned web development, Simon learned machine learning, Ian learned mechanics, and Jihee learned to electronics. 


## What's next for EcoDepot📈📈💹

EcoDepot at it's current state is more of a proof of concept that can demonstrate the utility of a project like this. We all believe a project like EcoDepot has endless potential and sustainable applications. All it takes is ONE university to implement this system for THOUSANDS of bottles and cans to be recycled instead of ending up in the dump. The code has scalability in mind to grow beyond our prototype in the future without requiring significant code changes.
