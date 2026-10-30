package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.graphics.*
import android.view.*
import android.widget.*
import java.io.ByteArrayOutputStream
import kotlin.math.*

/** Deterministic image-plane rectification, retaining the user's original image features. */
internal class ReferenceImageEditor(private val activity: Activity,private val source: Bitmap,
  private val accepted: (ByteArray,Float) -> Unit) {
  fun show() {
    val dialog=Dialog(activity)
    val root=LinearLayout(activity).apply { orientation=LinearLayout.HORIZONTAL; setPadding(28,24,28,24); setBackgroundColor(Color.rgb(12,19,28)) }
    val corners=CornerView(activity,source)
    root.addView(corners,LinearLayout.LayoutParams(0,-1,1.5f))
    val controls=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL; setPadding(16,0,0,0) }
    root.addView(ScrollView(activity).apply { addView(controls) },LinearLayout.LayoutParams(0,-1,1f))
    fun label(text: String)=TextView(activity).apply { this.text=text; textSize=15f; setTextColor(Color.WHITE); setPadding(4,8,4,8) }
    fun input(hint: String)=EditText(activity).apply { this.hint=hint; inputType=8194; setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY); setSingleLine() }
    controls.addView(label("参照图四角校正"))
    controls.addView(label("拖动四个圆点，贴合实物图像的四角，排除墙面、桌面和白边。按左上→右上→右下→左下排列。"))
    val width=input("实物图像宽度（厘米）"); val height=input("实物图像高度（厘米）")
    controls.addView(width); controls.addView(height)
    controls.addView(label("宽高对应选中图像，不是整张相片。登记后实物必须保持固定。"))
    controls.addView(Button(activity).apply {
      text="校正并预览"; isAllCaps=false
      setOnClickListener {
        try {
          val w=(width.text.toString().toFloatOrNull() ?: 0f)/100f
          val h=(height.text.toString().toFloatOrNull() ?: 0f)/100f
          val size=ReferenceGeometry.validate(corners.points,w,h)
          val crop=Bitmap.createBitmap(size.first,size.second,Bitmap.Config.ARGB_8888)
          val matrix=Matrix()
          val src=FloatArray(8) { corners.points[it]*(if (it%2==0) source.width-1 else source.height-1) }
          val dst=floatArrayOf(0f,0f,(size.first-1).toFloat(),0f,(size.first-1).toFloat(),(size.second-1).toFloat(),0f,(size.second-1).toFloat())
          check(matrix.setPolyToPoly(src,0,dst,0,4)) { "四角无法校正，请重新选择" }
          Canvas(crop).drawBitmap(source,matrix,Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
          val bytes=ByteArrayOutputStream().also { crop.compress(Bitmap.CompressFormat.JPEG,94,it) }.toByteArray()
          require(bytes.size<=2_000_000) { "校正图像过大，请选择纹理清晰、噪点较少的照片" }
          val preview=ImageView(activity).apply { setImageBitmap(crop); adjustViewBounds=true; scaleType=ImageView.ScaleType.FIT_CENTER }
          val frame=LinearLayout(activity).apply {
            orientation=LinearLayout.VERTICAL
            addView(label("校正结果 · 宽 %.1f / 高 %.1f 厘米\n确认画面只包含平面图像，文字没有缺失。".format(w*100,h*100)))
            addView(preview,LinearLayout.LayoutParams(-1,(190*resources.displayMetrics.density).toInt()))
          }
          val confirm=AlertDialog.Builder(activity).setTitle("确认参照图").setView(frame)
            .setNegativeButton("重新调整",null).setPositiveButton("登记此图") { _,_ ->
              accepted(bytes,w); dialog.dismiss()
            }.create()
          confirm.setOnDismissListener { preview.setImageDrawable(null); crop.recycle() }
          confirm.show()
        } catch (error: Exception) { Toast.makeText(activity,error.message ?: "校正失败，请重新调整",Toast.LENGTH_LONG).show() }
      }
    })
    controls.addView(Button(activity).apply { text="取消"; setOnClickListener { dialog.dismiss() } })
    dialog.setContentView(root)
    dialog.setOnDismissListener { source.recycle() }
    dialog.show()
    dialog.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.MATCH_PARENT)
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
  }

  private class CornerView(activity: Activity,private val image: Bitmap): View(activity) {
    val points=floatArrayOf(.12f,.12f,.88f,.12f,.88f,.88f,.12f,.88f)
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var selected=-1
    private var scale=1f; private var left=0f; private var top=0f
    override fun onDraw(canvas: Canvas) {
      canvas.drawColor(Color.BLACK)
      scale=min((width-48f)/image.width,(height-48f)/image.height)
      left=(width-image.width*scale)/2; top=(height-image.height*scale)/2
      canvas.drawBitmap(image,null,RectF(left,top,left+image.width*scale,top+image.height*scale),paint)
      val path=Path()
      fun x(i: Int)=left+points[2*i]*image.width*scale
      fun y(i: Int)=top+points[2*i+1]*image.height*scale
      path.moveTo(x(0),y(0)); for (i in 1..3) path.lineTo(x(i),y(i)); path.close()
      paint.color=Color.CYAN; paint.style=Paint.Style.STROKE; paint.strokeWidth=4f; canvas.drawPath(path,paint)
      paint.style=Paint.Style.FILL; paint.textSize=27f
      for (i in 0..3) {
        paint.color=Color.CYAN; canvas.drawCircle(x(i),y(i),17f,paint)
        paint.color=Color.BLACK; canvas.drawText("${i+1}",x(i)-8,y(i)+10,paint)
      }
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
      if (event.actionMasked==MotionEvent.ACTION_DOWN) {
        selected=(0..3).minByOrNull { i -> hypot(left+points[2*i]*image.width*scale-event.x,top+points[2*i+1]*image.height*scale-event.y) } ?: -1
        parent.requestDisallowInterceptTouchEvent(true)
      }
      if (selected>=0 && event.actionMasked in listOf(MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP)) {
        points[2*selected]=((event.x-left)/(image.width*scale)).coerceIn(0f,1f)
        points[2*selected+1]=((event.y-top)/(image.height*scale)).coerceIn(0f,1f)
        invalidate()
      }
      if (event.actionMasked==MotionEvent.ACTION_UP || event.actionMasked==MotionEvent.ACTION_CANCEL) { selected=-1; performClick() }
      return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
  }
}
