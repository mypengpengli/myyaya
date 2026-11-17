package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class HomeWorkflowTest {
  @Test fun cancelledSetupCannotRunOnLaterPostureConfirmation() {
    val inbox=HomeCommandInbox<Any>();val go=Any();inbox.queue(go);inbox.clear()
    assertNull(inbox.pending)
  }
  @Test fun incompleteSetupCanRetryButOldCompletionCannotClearReplacement() {
    val inbox=HomeCommandInbox<Any>();val first=Any();val next=Any();inbox.queue(first)
    assertSame(first,inbox.pending);inbox.queue(next);inbox.completed(first);assertSame(next,inbox.pending)
    inbox.completed(next);assertNull(inbox.pending)
  }
  @Test fun modelWarmupAndActiveNavigationBothExcludeTeaching() {
    for(phase in listOf("PREPARING","RUNNING"))assertThrows(IllegalStateException::class.java){HomeWorkflow.requireTeaching(phase,false)}
    HomeWorkflow.requireTeaching("PAUSED",false)
  }
  @Test fun teachingExcludesNavigationRegardlessOfEntryButton() {
    assertThrows(IllegalStateException::class.java){HomeWorkflow.requireNavigation("IDLE",true)}
    assertThrows(IllegalStateException::class.java){HomeWorkflow.requireNavigation("PREPARING",false)}
    HomeWorkflow.requireNavigation("PAUSED_RESTART",false)
  }
}
