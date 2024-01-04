const express = require("express");
const fs = require("fs");
const cron = require("node-cron"); // Import the node-cron library
const app = express();
const port = 6190;

app.use(express.json());

let validLicenseKeys = loadLicenseKeysFromFile(); // Load license keys from the text file

function loadLicenseKeysFromFile() {
  try {
    const data = fs.readFileSync("licenseKeys.txt", "utf8");
    const lines = data.split("\n");
    return lines
      .map((line) => {
        const [key, used, expirationPeriod, expirationDateTime, computerSID] =
          line.trim().split(",");
        return {
          key,
          used: used === "true",
          expirationPeriod,
          expirationDateTime,
          computerSID,
        };
      })
      .filter((license) => license.key); // Filter out empty lines
  } catch (error) {
    console.error("Error loading license keys from file:", error);
    return [];
  }
}

function saveLicenseKeysToFile() {
  const data = validLicenseKeys
    .map(
      (license) =>
        `${license.key},${license.used},${license.expirationPeriod},${license.expirationDateTime},${license.computerSID}`,
    )
    .join("\n");

  fs.writeFileSync("licenseKeys.txt", data);
}

function removeExpiredLicenses() {
  const currentDate = new Date();

  // Filter out expired licenses
  const validLicenses = validLicenseKeys.filter((license) => {
    if (license.used) {
      const expirationDate = new Date(license.expirationDateTime);

      // Log expiration dates for debugging
      console.log("License:", license.key);
      console.log("Current Date:", currentDate);
      console.log("Expiration Date:", expirationDate);

      // Keep the license if it has not expired
      return currentDate <= expirationDate;
    }

    // Keep non-used licenses
    return true;
  });

  // Log the deleted licenses
  const deletedLicenses = validLicenseKeys.filter(
    (license) => !validLicenses.includes(license),
  );
  console.log("Deleted Licenses:", deletedLicenses);

  // Update the valid licenses array
  validLicenseKeys = validLicenses;

  // Update the text file database with the valid licenses
  saveLicenseKeysToFile();
}

function calculateExpirationDate(expirationPeriod, expirationDateTime) {
  const expirationDate = new Date(expirationDateTime);
  switch (expirationPeriod.slice(-1).toUpperCase()) {
    case "D":
      expirationDate.setDate(
        expirationDate.getDate() + parseInt(expirationPeriod, 10),
      );
      break;
    case "W":
      expirationDate.setDate(
        expirationDate.getDate() + 7 * parseInt(expirationPeriod, 10),
      );
      break;
    case "M":
      expirationDate.setMonth(
        expirationDate.getMonth() + parseInt(expirationPeriod, 10),
      );
      break;
    case "H":
      expirationDate.setHours(
        expirationDate.getHours() + parseInt(expirationPeriod, 10),
      );
      break;
    default:
      console.error("Invalid expiration period:", expirationPeriod);
  }
  return expirationDate;
}

function cleanUndefinedSIDs() {
  const userDatabasePath = "UserDatabase.txt";
  const data = fs.readFileSync(userDatabasePath, "utf8");
  const lines = data.split("\n");
  const cleanedLines = lines.filter((line) => {
    const [sid, ip] = line.split(",");
    return sid !== "undefined";
  });
  fs.writeFileSync(userDatabasePath, cleanedLines.join("\n"));
}
function removeDuplicateSIDsAndIPs() {
  const userDatabasePath = "UserDatabase.txt";
  const data = fs.readFileSync(userDatabasePath, "utf8");
  const lines = data.split("\n");
  const uniqueLines = Array.from(new Set(lines)); // Use Set to get unique lines
  fs.writeFileSync(userDatabasePath, uniqueLines.join("\n"));
}
// Schedule a task to run every 5 minutes to remove expired licenses
cron.schedule("*/5 * * * *", () => {
  removeExpiredLicenses();
  cleanUndefinedSIDs();
  removeDuplicateSIDsAndIPs();
});

function logUserSIDAndIP(computerSID, ipAddress) {
  fs.appendFileSync("UserDatabase.txt", `${computerSID},${ipAddress}\n`);
}

app.get("/api/verify/supowtkensei", (req, res) => {
  //const { key, computerSID } = req.query;
  const { key, computerSID, ipAddress } = req.query;

  // Find the license key in the database.
  const license = validLicenseKeys.find((license) => license.key === key);

  if (license) {
    if (!license.used) {
      // Check if the SID is already associated with another active license.
      const existingLicenseWithSID = validLicenseKeys.find(
        (l) => l.computerSID === computerSID && l.used && l.key !== key,
      );

      if (existingLicenseWithSID) {
        res.json({
          valid: false,
          message:
            "This device has already have an active license, please use your active license registered in your device.",
        });
        return;
      }

      if (license.computerSID === computerSID || license.computerSID === "") {
        // Mark the license as used and generate the expiration date.
        license.used = true;

        // Check if the expirationDateTime is not already set (i.e., the license is used for the first time)
        if (!license.expirationDateTime) {
          license.expirationDateTime = new Date();
          const expirationDate = calculateExpirationDate(
            license.expirationPeriod,
            license.expirationDateTime,
          );
          license.expirationDateTime = expirationDate;
        }

        // Associate the license with the computer's SID.
        license.computerSID = computerSID;

        // Update the text file database.
        saveLicenseKeysToFile();
        res.json({
          valid: true,
          expirationDate: license.expirationDateTime.toISOString(),
        });
      } else {
        // The license has already been used on another computer or SID does not match.
        res.json({
          valid: false,
          message: "License key is not valid for this computer.",
        });
      }
    } else if (license.computerSID === computerSID) {
      // The license has already been used on this computer, but check the expiration date.
      const expirationDate = new Date(license.expirationDateTime);

      if (expirationDate >= new Date()) {
        res.json({
          valid: true,
          message: "License key has already been used on this computer.",
          expirationDate: expirationDate.toISOString(),
        });
      } else {
        res.json({ valid: false, message: "License key has expired." });
      }
    } else {
      // The license has already been used on another computer.
      res.json({
        valid: false,
        message: "License key has already been used on another computer.",
      });
    }
  } else {
    res.json({ valid: false, message: "Invalid license key." });
  }

  logUserSIDAndIP(computerSID, ipAddress); // Log user SID and IP
});

app.listen(port, () => {
  console.log(`API server is running on port ${port}`);
});

//Stable Save Point Here
