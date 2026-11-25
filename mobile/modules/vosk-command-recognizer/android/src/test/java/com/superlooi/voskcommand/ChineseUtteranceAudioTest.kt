package com.superlooi.voskcommand

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

class ChineseUtteranceAudioTest {
  @Test fun wavHasReal16kPcmAndResets(){val a=ChineseUtteranceAudio();a.append(FloatArray(8000){1000f});val wav=a.finish()!!;assertEquals(16044,wav.size);assertEquals("RIFF",String(wav.copyOfRange(0,4)));assertEquals(16000,ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN).getInt(24));assertNull(a.finish())}
  @Test fun overflowAndSilenceNeverUploadTruncatedAudio(){val a=ChineseUtteranceAudio(5000);a.append(FloatArray(6000){500f});assertNull(a.finish());a.append(FloatArray(5000));assertNull(a.finish());a.append(FloatArray(5000){500f});assertNotNull(a.finish())}
  @Test fun energyContrastDistinguishesQuietNoiseAndSpeech(){val quiet=ChineseAudioQuality.summarize(ShortArray(16000){100});val speech=ChineseAudioQuality.summarize(ShortArray(16000){if(it<8000)100 else 3000});assertEquals(0.0,quiet.getValue("levelContrastDb"),.001);assertTrue(speech.getValue("levelContrastDb")>20)}
}
