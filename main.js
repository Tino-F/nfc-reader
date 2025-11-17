const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { NFC } = require("nfc-pcsc");
const readNdef = require('./readNdef');

let mainWindow;
let nfc;
let tagHistory = new Map(); // tagId별 태그 이력 저장
let currentBoothId = ""; // 현재 선택된 부스 ID
let currentBoothName = ""; // 현재 선택된 부스 이름

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");

  // 개발 중에는 개발자 도구를 엽니다
  mainWindow.webContents.openDevTools();
}

// 서버에 tagId와 boothId 전송
async function sendTagToServer(tagId, boothId, boothName) {
  console.log(
    `\n서버에 전송 - tagId: ${tagId}, boothId: ${boothId}, boothName: ${boothName}`
  );

  try {
    const response = await fetch(
      "https://playtime.vvfystudio.com/api/booth-tag",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tagId,
          boothId,
          boothName,
          scoreAmount: 30, // 기본 점수
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("서버 응답:", data);

    return data;
  } catch (error) {
    console.error("서버 통신 오류:", error);
    throw error;
  }
}

// 음성 재생
function playSound(soundName) {
  const soundPath = path.join(
    __dirname,
    "assets",
    "sounds",
    `${soundName}.mp3`
  );
  console.log(`음성 재생: ${soundPath}`);

  // 렌더러 프로세스에 음성 재생 요청
  mainWindow.webContents.send("play-sound", { soundPath });
}

// URL에서 tagId 추출
function extractTagId(url) {
  try {
    const urlObj = new URL(url);
    const tagId = urlObj.searchParams.get("tagId");
    console.log(`URL에서 추출한 tagId: ${tagId}`);
    return tagId;
  } catch (err) {
    console.error("tagId 추출 실패:", err);
    return null;
  }
}

function initNFC() {
  nfc = new NFC();

  nfc.on("reader", (reader) => {
    console.log(`${reader.reader.name} 리더기가 연결되었습니다`);

    // ISO 14443-4 태그를 위한 NDEF 애플리케이션 AID 설정
    // 이렇게 하면 ISO 14443-4 태그 감지 시 자동으로 SELECT FILE 명령이 실행됩니다
    // 응답은 card.data에 담겨 card 이벤트로 전달됩니다
    reader.aid = "D2760000850101";

    // 리더기 연결 정보를 렌더러로 전송
    mainWindow.webContents.send("reader-status", {
      status: "connected",
      name: reader.reader.name,
    });

    reader.on("card", async (card) => {
      console.log("\n=== 카드 감지 ===");
      console.log("전체 카드 정보:", JSON.stringify(card, null, 2));
      console.log("타입:", card.type);
      console.log("표준:", card.standard);
      console.log("UID:", card.uid);
      console.log("ATR:", card.atr ? card.atr.toString("hex") : "N/A");
      console.log("Data:", card.data ? card.data.toString("hex") : "N/A");

      // 카드 정보를 렌더러로 전송
      mainWindow.webContents.send("card-detected", {
        uid: card.uid || "N/A",
        atr: card.atr ? card.atr.toString("hex") : "N/A",
      });

      try {
        let ndefData = null;

        // card.data가 있으면 먼저 확인 (ISO 14443-4 with AID)
        if (card.data && card.data.length > 0) {
          console.log("\ncard.data가 존재함 (AID SELECT 응답)");
          console.log("데이터:", card.data.toString("hex"));
          ndefData = card.data;
        }

        const ndefStr = await readNdef( reader );
				const url = ndefStr ? 'https://' + ndefStr : undefined;
				
				if (url) {
            console.log("✅ URL 발견:", url);

            // tagId 추출
            const tagId = extractTagId(url);

            if (tagId) {
              // 부스 선택 확인
              if (!currentBoothId) {
                console.error("부스가 선택되지 않음");
                mainWindow.webContents.send("error", {
                  message: "부스를 먼저 선택해주세요!",
                });
                return;
              }

              // 서버에 전송
              try {
                const serverResponse = await sendTagToServer(
                  tagId,
                  currentBoothId,
                  currentBoothName
                );
                console.log("서버 응답:", serverResponse);

                // 응답 메시지에 따라 음성 재생
                let soundName;
                switch (serverResponse.message) {
                  case "SUCCESS":
                    soundName = "success";
                    break;
                  case "ALREADY_TAGGED":
                    soundName = "fail";
                    break;
                  case "TAG_NOT_FOUND":
                    soundName = "fail";
                    break;
                  case "INVALID_TAG_ID":
                    soundName = "fail";
                    break;
                  case "INVALID_BOOTH_ID":
                    soundName = "fail";
                    break;
                  case "SERVER_ERROR":
                    soundName = "fail";
                    break;
                  default:
                    soundName = "fail";
                }
                playSound(soundName);

                // UI에 결과 표시
                mainWindow.webContents.send("tag-processed", {
                  url,
                  tagId,
                  serverResponse,
                });
              } catch (serverErr) {
                console.error("서버 통신 실패:", serverErr);
                mainWindow.webContents.send("error", {
                  message: "서버 통신 실패: " + serverErr.message,
                });
                playSound("fail");
              }
            } else {
              mainWindow.webContents.send("url-detected", { url });
            }
          } else {
            console.log("❌ URL을 찾을 수 없음, 원시 데이터 표시");
            mainWindow.webContents.send("data-read", {
              hex: ndefData.toString("hex"),
              text: ndefData.toString("utf8").replace(/[^\x20-\x7E]/g, ""),
            });
          }
        
      } catch (err) {
        console.error("\n=== 에러 발생 ===");
        console.error("메시지:", err.message);
        console.error("스택:", err.stack);
        mainWindow.webContents.send("error", {
          message: "데이터 읽기 실패: " + err.message,
        });
      }
    });

    reader.on("card.off", (card) => {
      console.log("카드가 제거되었습니다");
      mainWindow.webContents.send("card-removed");
    });

    reader.on("error", (err) => {
      console.error("리더기 오류:", err);
      mainWindow.webContents.send("error", {
        message: "리더기 오류: " + err.message,
      });
    });

    reader.on("end", () => {
      console.log("리더기 연결이 종료되었습니다");
      mainWindow.webContents.send("reader-status", {
        status: "disconnected",
      });
    });
  });

  nfc.on("error", (err) => {
    console.error("NFC 오류:", err);
    mainWindow.webContents.send("error", {
      message: "NFC 초기화 오류: " + err.message,
    });
  });
}

// NDEF 메시지에서 URL 파싱
function parseNDEF(data) {
  try {
    console.log("NDEF 파싱 시작, 데이터 길이:", data.length);
    console.log("첫 20바이트:", data.slice(0, 20).toString("hex"));

    let ndefMessage;
    let startIndex = 0;

    // 길이 필드 건너뛰기
    if (data[0] === 0x00) {
      // 2바이트 길이 (빅엔디안)
      const length = (data[0] << 8) | data[1];
      console.log("2바이트 길이 헤더:", length);
      startIndex = 2;
      ndefMessage = data.slice(2);
    } else if (data[0] === 0x03) {
      // TLV 형식
      const length = data[1];
      console.log("TLV 형식, 길이:", length);
      startIndex = 2;
      ndefMessage = data.slice(2, 2 + length);
    } else {
      ndefMessage = data;
    }

    console.log(
      "NDEF 메시지 시작 바이트:",
      ndefMessage.slice(0, 10).toString("hex")
    );

    // NDEF 레코드 파싱
    let offset = 0;

    while (offset < ndefMessage.length && ndefMessage[offset] !== 0x00) {
      const flags = ndefMessage[offset];
      const mb = (flags & 0x80) !== 0; // Message Begin
      const me = (flags & 0x40) !== 0; // Message End
      const cf = (flags & 0x20) !== 0; // Chunk Flag
      const sr = (flags & 0x10) !== 0; // Short Record
      const il = (flags & 0x08) !== 0; // ID Length present
      const tnf = flags & 0x07; // Type Name Format

      console.log(
        `\n레코드 플래그: 0x${flags.toString(
          16
        )}, TNF: ${tnf}, SR: ${sr}, MB: ${mb}, ME: ${me}`
      );

      offset++;
      if (offset >= ndefMessage.length) break;

      const typeLength = ndefMessage[offset++];
      console.log("타입 길이:", typeLength);

      let payloadLength;
      if (sr) {
        payloadLength = ndefMessage[offset++];
        console.log("페이로드 길이 (short):", payloadLength);
      } else {
        payloadLength =
          (ndefMessage[offset] << 24) |
          (ndefMessage[offset + 1] << 16) |
          (ndefMessage[offset + 2] << 8) |
          ndefMessage[offset + 3];
        offset += 4;
        console.log("페이로드 길이 (long):", payloadLength);
      }

      const idLength = il ? ndefMessage[offset++] : 0;

      const recordType = ndefMessage
        .slice(offset, offset + typeLength)
        .toString();
      console.log("레코드 타입:", recordType);
      offset += typeLength;

      if (idLength > 0) {
        offset += idLength; // ID 건너뛰기
      }

      if (payloadLength > 0 && payloadLength < 10000) {
        const payload = ndefMessage.slice(offset, offset + payloadLength);
        console.log("페이로드 (hex):", payload.slice(0, 50).toString("hex"));
        console.log(
          "페이로드 (text):",
          payload.toString("utf8").substring(0, 100)
        );
        offset += payloadLength;

        // URI Record 처리 (TNF = 1, Type = "U")
        if (tnf === 0x01 && recordType === "U") {
          const uriIdentifier = payload[0];
          const uriPrefixes = [
            "",
            "http://www.",
            "https://www.",
            "http://",
            "https://",
            "tel:",
            "mailto:",
            "ftp://anonymous:anonymous@",
            "ftp://ftp.",
            "ftps://",
            "sftp://",
            "smb://",
            "nfs://",
            "ftp://",
            "dav://",
            "news:",
            "telnet://",
            "imap:",
            "rtsp://",
            "urn:",
            "pop:",
            "sip:",
            "sips:",
            "tftp:",
            "btspp://",
            "btl2cap://",
            "btgoep://",
            "tcpobex://",
            "irdaobex://",
            "file://",
            "urn:epc:id:",
            "urn:epc:tag:",
            "urn:epc:pat:",
            "urn:epc:raw:",
            "urn:epc:",
            "urn:nfc:",
          ];

          const prefix = uriPrefixes[uriIdentifier] || "";
          const uri =
            prefix + payload.slice(1).toString("utf8").replace(/\0/g, "");
          console.log("✅ URI 레코드 발견:", uri);
          return uri;
        }

        // Text Record 처리 (TNF = 1, Type = "T")
        if (tnf === 0x01 && recordType === "T") {
          const languageCodeLength = payload[0] & 0x3f;
          const text = payload.slice(1 + languageCodeLength).toString("utf8");
          console.log("텍스트 레코드 발견:", text);

          // 텍스트에서 URL 찾기
          const urlMatch = text.match(/(https?:\/\/[^\s\0]+)/);
          if (urlMatch) {
            console.log("✅ 텍스트에서 URL 추출:", urlMatch[1]);
            return urlMatch[1];
          }
        }

        // Absolute URI (TNF = 3)
        if (tnf === 0x03) {
          const uri = payload.toString("utf8").replace(/\0/g, "");
          console.log("✅ Absolute URI 발견:", uri);
          return uri;
        }
      } else {
        console.log("잘못된 페이로드 길이:", payloadLength);
        break;
      }

      if (me) break; // Message End
    }

    // 원시 텍스트에서 URL 찾기
    const text = data.toString("utf8");
    const urlMatch = text.match(/(https?:\/\/[^\s\0]+)/);
    if (urlMatch) {
      console.log("✅ 원시 텍스트에서 URL 추출:", urlMatch[1]);
      return urlMatch[1];
    }

    // URL 패턴 찾기 (http/https 없이)
    const domainMatch = text.match(/([a-z0-9-]+\.[a-z0-9-.]+\/[^\s\0]+)/i);
    if (domainMatch) {
      const url = "https://" + domainMatch[1];
      console.log("✅ 도메인 패턴에서 URL 생성:", url);
      return url;
    }

    console.log("❌ URL을 찾을 수 없음");
    return null;
  } catch (err) {
    console.error("NDEF 파싱 오류:", err);
    return null;
  }
}

app.whenReady().then(() => {
  createWindow();
  initNFC();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (nfc) {
    nfc.close();
  }
});

// 렌더러로부터 부스 선택 받기
ipcMain.on("set-booth", (event, data) => {
  currentBoothId = data.boothId;
  currentBoothName = data.boothName;
  console.log(`부스 설정됨: ${currentBoothId} - ${currentBoothName}`);
});
